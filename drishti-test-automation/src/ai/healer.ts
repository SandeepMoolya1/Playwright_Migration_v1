/**
 * The auto-healing engine.
 *
 * Healing runs as a four-tier cascade, cheapest and most certain first:
 *
 *   0. Primary chain      - the locator as written, waited for with the test's
 *                           real timeout. A slow-rendering element must never
 *                           be treated as a broken one.
 *   1. Declared fallbacks - alternatives the engineer wrote in the YAML.
 *   2. Heuristic match    - deterministic scoring of live page candidates
 *                           against the element's declared intent. Offline.
 *   3. AI heal            - Claude picks the element from the accessibility
 *                           tree and candidate list, and we validate its
 *                           proposal against the live page before trusting it.
 *
 * Every tier's result is validated the same way: the proposed chain must
 * actually resolve on the page. The model never gets to "fix" anything by
 * assertion alone.
 */
import type { Locator, Page } from '@playwright/test';
import fs from 'node:fs';
import { getConfig } from '../core/config.js';
import { createLogger } from '../core/logger.js';
import { artifact } from '../core/config.js';
import type { HealRecord, LocatorDefinition, LocatorStep } from '../core/types.js';
import type { ResolvedElement } from '../locators/repository.js';
import { getRepository } from '../locators/repository.js';
import { buildDefinition, explain } from '../locators/resolver.js';
import { describeSteps } from '../locators/schema.js';
import { persistHeal } from '../locators/writer.js';
import { capturePage, renderCandidates } from '../dom/snapshot.js';
import { hasClearWinner, rankCandidates } from '../dom/candidates.js';
import { structured } from './client.js';
import { HEAL_SYSTEM } from './prompts.js';
import { healProposalJsonSchema, healProposalSchema } from './schemas.js';

const log = createLogger('heal');

export class ElementNotFoundError extends Error {
  constructor(
    public readonly key: string,
    public readonly attempted: string[],
    cause: string,
  ) {
    super(
      `Could not resolve "${key}" after exhausting every strategy.\n` +
        `  Attempted:\n${attempted.map((a) => `    - ${a}`).join('\n')}\n` +
        `  Last error: ${cause}\n` +
        `  Fix: update the locator in YAML, or run \`npx aiqa scan <url>\` to regenerate it.`,
    );
    this.name = 'ElementNotFoundError';
  }
}

/** Per-run state shared across fixtures and read by the reporter. */
class HealSession {
  readonly records: HealRecord[] = [];
  aiCalls = 0;
  private cache = new Map<string, LocatorStep[]>();
  private cacheLoaded = false;

  private cachePath(): string {
    return artifact('heal-cache.json');
  }

  loadCache(): void {
    if (this.cacheLoaded) return;
    this.cacheLoaded = true;
    try {
      const file = this.cachePath();
      if (!fs.existsSync(file)) return;
      const data = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, LocatorStep[]>;
      for (const [k, v] of Object.entries(data)) this.cache.set(k, v);
    } catch {
      /* a corrupt cache is not worth failing a run over */
    }
  }

  getCached(key: string): LocatorStep[] | undefined {
    this.loadCache();
    return this.cache.get(key);
  }

  putCached(key: string, steps: LocatorStep[]): void {
    this.loadCache();
    this.cache.set(key, steps);
    try {
      fs.writeFileSync(
        this.cachePath(),
        JSON.stringify(Object.fromEntries(this.cache), null, 2),
        'utf8',
      );
    } catch {
      /* best effort */
    }
  }

  record(rec: HealRecord): void {
    this.records.push(rec);
    try {
      fs.appendFileSync(artifact('heal-journal.jsonl'), `${JSON.stringify(rec)}\n`, 'utf8');
    } catch {
      /* best effort */
    }
  }
}

const session = new HealSession();

/** Records produced so far in this worker. The reporter merges across workers. */
export function healRecords(): readonly HealRecord[] {
  return session.records;
}

export interface HealContext {
  page: Page;
  element: ResolvedElement;
  /** Timeout for the primary attempt — normally the test's action timeout. */
  timeout?: number;
  testTitle?: string;
}

export interface HealOutcome {
  locator: Locator;
  /** Present when a tier other than the primary chain produced the locator. */
  healed?: HealRecord;
}

/**
 * Validate a chain against the live page. Success means it resolves to at
 * least one attached element within the budget.
 *
 * `requireUnique` additionally rejects a chain that matches several elements.
 * It is off for the locator as written — an ambiguous hand-written locator
 * should surface as Playwright's own strict-mode error at action time, which
 * says far more than "healing failed" — and on for every *healed* candidate,
 * because a replacement that matches five things is not a repair.
 */
async function probe(
  page: Page,
  definition: LocatorDefinition,
  steps: LocatorStep[],
  timeout: number,
  requireUnique: boolean,
): Promise<{ ok: true; locator: Locator } | { ok: false; reason: string }> {
  try {
    const locator = buildDefinition(page, definition, steps);
    await locator.first().waitFor({ state: 'attached', timeout });

    if (requireUnique) {
      const count = await locator.count();
      if (count > 1) {
        return {
          ok: false,
          reason:
            `resolved to ${count} elements — ambiguous. ` +
            `If this element is a list, set \`multiple: true\` on it in the YAML.`,
        };
      }
    }
    return { ok: true, locator };
  } catch (err) {
    return { ok: false, reason: shortError(err) };
  }
}

function shortError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.split('\n')[0]?.slice(0, 200) ?? 'unknown error';
}

/**
 * Resolve an element, healing if necessary. Always returns a usable locator
 * or throws `ElementNotFoundError` with the full audit trail.
 */
export async function resolveWithHealing(ctx: HealContext): Promise<HealOutcome> {
  const cfg = getConfig();
  const { page, element } = ctx;
  const def = element.definition;
  const started = Date.now();
  const attempted: string[] = [];

  const primaryTimeout = ctx.timeout ?? 10_000;
  const secondaryTimeout = Math.min(3_000, primaryTimeout);

  // A collection, or an explicitly indexed element, may legitimately match
  // many nodes; anything else must heal to exactly one.
  const requireUnique = !def.multiple && def.index === undefined;

  // ---- Tier 0: the locator as written -----------------------------------
  const primary = await probe(page, def, def.steps, primaryTimeout, false);
  if (primary.ok) return { locator: primary.locator };
  attempted.push(`${explain(def)} -> ${primary.reason}`);

  const healingOn = cfg.heal.enabled && def.heal !== false;
  if (!healingOn) throw new ElementNotFoundError(element.key, attempted, primary.reason);

  log.heal(`"${element.key}" did not resolve — starting heal cascade`);

  const finish = async (
    steps: LocatorStep[],
    locator: Locator,
    source: HealRecord['source'],
    confidence: number,
    reasoning?: string,
  ): Promise<HealOutcome> => {
    const record: HealRecord = {
      key: element.key,
      file: element.sourcePath,
      element: element.element,
      description: def.description,
      failedWith: explain(def),
      healedWith: steps,
      confidence,
      source,
      reasoning,
      persisted: false,
      url: page.url(),
      testTitle: ctx.testTitle,
      at: new Date().toISOString(),
      durationMs: Date.now() - started,
    };

    // Apply in memory so the rest of the run uses the working locator.
    const next: LocatorDefinition = { ...def, steps };
    getRepository().patch(element.key, next);

    // A declared fallback is an intended alternative, not drift, so it never
    // rewrites the file; nor does a file that opted out of write-back.
    const mayPersist =
      cfg.heal.persist &&
      element.meta.persistHeals !== false &&
      confidence >= cfg.heal.persistMinConfidence &&
      source !== 'fallback';

    if (mayPersist) {
      persistHeal({
        sourcePath: element.sourcePath,
        element: element.element,
        previous: def,
        healedSteps: steps,
      });
      record.persisted = true;
    } else {
      record.notPersistedBecause =
        source === 'fallback' ? 'fallback'
        : element.meta.persistHeals === false ? 'opted-out'
        : !cfg.heal.persist ? 'persist-disabled'
        : 'low-confidence';
    }

    session.record(record);
    log.ok(
      `healed "${element.key}" via ${source} (${(confidence * 100).toFixed(0)}%): ` +
        `${describeSteps(steps)}`,
    );
    return { locator, healed: record };
  };

  // ---- Tier 1: engineer-declared fallbacks ------------------------------
  for (const chain of def.fallbacks ?? []) {
    const result = await probe(page, def, chain, secondaryTimeout, requireUnique);
    if (result.ok) {
      // A declared fallback is an intended alternative, not drift: use it,
      // record it, but never rewrite the YAML on its account.
      return finish(chain, result.locator, 'fallback', 1, 'declared fallback matched');
    }
    attempted.push(`fallback ${describeSteps(chain)} -> ${result.reason}`);
  }

  // From here we need to look at the page itself.
  const snapshot = await capturePage(page, {
    testIdAttribute: element.meta.testIdAttribute ?? cfg.testIdAttribute,
    maxChars: cfg.ai.maxSnapshotChars,
  });

  // ---- Cache: same element, same page structure, already solved ---------
  const cacheKey = `${element.key}::${snapshot.signature}`;
  if (cfg.heal.cache) {
    const cached = session.getCached(cacheKey);
    if (cached) {
      const result = await probe(page, def, cached, secondaryTimeout, requireUnique);
      if (result.ok) {
        return finish(cached, result.locator, 'heuristic', 0.95, 'reused cached heal');
      }
    }
  }

  // ---- Tier 2: deterministic heuristic ranking --------------------------
  //
  // Accepted only when the best candidate is an unambiguous winner. Two
  // plausible matches means we do not know which control the test meant, and
  // that is precisely the case worth paying the model to disambiguate.
  const ranked = rankCandidates(element.element, def, snapshot.candidates);
  if (hasClearWinner(ranked, cfg.heal.heuristicMinScore)) {
    const best = ranked[0]!;
    const result = await probe(page, def, best.steps, secondaryTimeout, requireUnique);
    if (result.ok) {
      if (cfg.heal.cache) session.putCached(cacheKey, best.steps);
      return finish(
        best.steps,
        result.locator,
        'heuristic',
        best.score,
        `unambiguous match: <${best.candidate.tag}> role=${best.candidate.role} ` +
          `name="${best.candidate.name}"` +
          (ranked[1] ? ` (runner-up scored ${ranked[1].score.toFixed(2)})` : ''),
      );
    }
    attempted.push(`heuristic ${describeSteps(best.steps)} -> ${result.reason}`);
  } else if (ranked.length) {
    attempted.push(
      `heuristic: no clear winner (best ${ranked[0]!.score.toFixed(2)}, ` +
        `runner-up ${ranked[1]?.score.toFixed(2) ?? 'n/a'})`,
    );
  }

  // ---- Tier 3: AI heal ---------------------------------------------------
  if (session.aiCalls >= cfg.heal.maxPerRun) {
    log.warn(`AI heal budget exhausted (${cfg.heal.maxPerRun} per run) — not calling the model`);
    throw new ElementNotFoundError(element.key, attempted, primary.reason);
  }

  session.aiCalls += 1;
  const proposal = await withTimeout(
    askModel(element, def, snapshot, ranked.map((r) => r.candidate.ref)),
    cfg.heal.timeoutMs,
  );

  if (proposal) {
    if (proposal.elementMissing) {
      log.warn(`model reports "${element.key}" is not present on ${page.url()}`);
    }
    for (const candidate of proposal.proposals) {
      if (candidate.confidence < cfg.heal.minConfidence) continue;
      const steps = candidate.steps as LocatorStep[];
      const result = await probe(page, def, steps, secondaryTimeout, requireUnique);
      if (result.ok) {
        if (cfg.heal.cache) session.putCached(cacheKey, steps);
        return finish(steps, result.locator, 'ai', candidate.confidence, candidate.reasoning);
      }
      attempted.push(`ai ${describeSteps(steps)} -> ${result.reason}`);
    }
  }

  throw new ElementNotFoundError(element.key, attempted, primary.reason);
}

async function askModel(
  element: ResolvedElement,
  def: LocatorDefinition,
  snapshot: Awaited<ReturnType<typeof capturePage>>,
  heuristicRefs: string[],
) {
  const user = [
    `## Element the test is looking for`,
    `key: ${element.key}`,
    `intent: ${def.description ?? '(no description provided — infer from the key and the failed locator)'}`,
    `locator that stopped working: ${explain(def)}`,
    def.fallbacks?.length
      ? `fallbacks that also failed: ${def.fallbacks.map(describeSteps).join(' | ')}`
      : '',
    '',
    `## Page`,
    `url: ${snapshot.url}`,
    `title: ${snapshot.title}`,
    '',
    `## Accessibility tree`,
    '```yaml',
    snapshot.aria || '(unavailable)',
    '```',
    '',
    `## Candidate elements (css field is verified unique on this page)`,
    '```',
    renderCandidates(snapshot.candidates),
    '```',
    heuristicRefs.length
      ? `\nA deterministic matcher ranked these highest but none validated: ${heuristicRefs
          .slice(0, 5)
          .join(', ')}`
      : '',
    '',
    'Which element did the test mean? Propose locators, best first.',
  ]
    .filter((l) => l !== '')
    .join('\n');

  return structured({
    system: HEAL_SYSTEM,
    user,
    schema: healProposalSchema,
    jsonSchema: healProposalJsonSchema,
    purpose: 'heal',
    effort: 'medium',
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms).unref?.()),
  ]);
}
