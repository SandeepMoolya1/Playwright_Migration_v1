/**
 * `aiqa scan` — turn a live page into a YAML locator file.
 *
 * Two modes:
 *   - AI mode (default): the model names elements by their role in the user
 *     journey and writes the descriptions that later drive healing.
 *   - `--no-ai`: a purely deterministic extraction from the candidate list.
 *     Names are derived from accessible names and test ids. Less elegant, but
 *     it works offline and costs nothing.
 */
import { chromium, type Browser, type Page } from '@playwright/test';
import { getConfig } from '../core/config.js';
import { createLogger } from '../core/logger.js';
import { capturePage, renderCandidates, type PageSnapshot } from '../dom/snapshot.js';
import { stepsForCandidate, tokenize } from '../dom/candidates.js';
import { renderLocatorFile } from '../locators/writer.js';
import { structured } from './client.js';
import { SCAN_SYSTEM } from './prompts.js';
import { scanResultJsonSchema, scanResultSchema } from './schemas.js';
import type { LocatorDefinition, LocatorStep } from '../core/types.js';

const log = createLogger('scan');

export interface ScanOptions {
  url: string;
  /** Namespace for the generated file. Inferred from the URL when omitted. */
  name?: string;
  useAi?: boolean;
  headed?: boolean;
  /** CSS scope — limits the scan to one region of the page. */
  scope?: string;
  /** Run before capture: log in, dismiss a cookie banner, open a tab. */
  setup?: (page: Page) => Promise<void>;
  /** Extra wait for SPA hydration. */
  waitForSelector?: string;
  storageState?: string;
}

export interface ScanOutput {
  name: string;
  yaml: string;
  elementCount: number;
  snapshot: PageSnapshot;
}

/** `https://shop.test/checkout/payment` -> `checkoutPayment` */
function nameFromUrl(url: string): string {
  try {
    const { pathname } = new URL(url);
    const parts = pathname.split('/').filter(Boolean).slice(-2);
    if (!parts.length) return 'home';
    const camel = parts
      .flatMap((p) => tokenize(p))
      .map((t, i) => (i === 0 ? t : t.charAt(0).toUpperCase() + t.slice(1)))
      .join('');
    return camel || 'page';
  } catch {
    return 'page';
  }
}

/** Deduplicate names: `submitButton`, `submitButton2`, ... */
function uniqueName(base: string, taken: Set<string>): string {
  let name = base || 'element';
  let n = 2;
  while (taken.has(name)) name = `${base}${n++}`;
  taken.add(name);
  return name;
}

/** Deterministic extraction — no model involved. */
function deterministicElements(snapshot: PageSnapshot): Record<string, LocatorDefinition> {
  const taken = new Set<string>();
  const out: Record<string, LocatorDefinition> = {};

  const ROLE_SUFFIX: Record<string, string> = {
    button: 'Button',
    link: 'Link',
    textbox: 'Input',
    searchbox: 'Search',
    checkbox: 'Checkbox',
    radio: 'Radio',
    combobox: 'Select',
    heading: 'Heading',
    table: 'Table',
    list: 'List',
    alert: 'Alert',
  };

  for (const candidate of snapshot.candidates) {
    if (!candidate.visible) continue;
    const label = candidate.testId ?? candidate.name ?? candidate.placeholder ?? '';
    if (!label) continue;

    const tokens = tokenize(label).slice(0, 4);
    if (!tokens.length) continue;
    const camel = tokens
      .map((t, i) => (i === 0 ? t : t.charAt(0).toUpperCase() + t.slice(1)))
      .join('');
    const suffix = ROLE_SUFFIX[candidate.role] ?? '';
    const base = suffix && !camel.toLowerCase().endsWith(suffix.toLowerCase())
      ? `${camel}${suffix}`
      : camel;

    const steps = stepsForCandidate(candidate);
    const fallbacks: LocatorStep[][] = [];
    // Always keep the verified-unique CSS path as a safety net.
    if (steps[0]?.strategy !== 'css') fallbacks.push([{ strategy: 'css', selector: candidate.ref }]);

    out[uniqueName(base, taken)] = {
      description: `${candidate.role} "${candidate.name || label}" on this page`,
      steps,
      fallbacks: fallbacks.length ? fallbacks : undefined,
    };
  }

  return out;
}

/** Ask the model to name, describe and prioritise the elements. */
async function aiElements(
  snapshot: PageSnapshot,
  fallbackName: string,
): Promise<{ name: string; description: string; elements: Record<string, LocatorDefinition> } | null> {
  const user = [
    `## Page`,
    `url: ${snapshot.url}`,
    `title: ${snapshot.title}`,
    '',
    `## Accessibility tree`,
    '```yaml',
    snapshot.aria || '(unavailable)',
    '```',
    '',
    `## Candidate elements (the "css:" value is verified unique on this page)`,
    '```',
    renderCandidates(snapshot.candidates, 200),
    '```',
    '',
    'Produce the locator repository for this page.',
  ].join('\n');

  const result = await structured({
    system: SCAN_SYSTEM,
    user,
    schema: scanResultSchema,
    jsonSchema: scanResultJsonSchema,
    purpose: 'scan',
    effort: 'high',
    maxTokens: 16_000,
  });

  if (!result) return null;

  const taken = new Set<string>();
  const elements: Record<string, LocatorDefinition> = {};
  for (const el of result.elements) {
    elements[uniqueName(el.name, taken)] = {
      description: el.description,
      steps: el.steps as LocatorStep[],
      fallbacks: el.fallbacks as LocatorStep[][] | undefined,
      tags: el.tags,
    };
  }

  return {
    name: result.page.name || fallbackName,
    description: result.page.description,
    elements,
  };
}

/** Scan an already-open page. Used by `aiqa scan` and by codegen. */
export async function scanPage(page: Page, opts: ScanOptions): Promise<ScanOutput> {
  const cfg = getConfig();
  const snapshot = await capturePage(page, {
    testIdAttribute: cfg.testIdAttribute,
    maxChars: cfg.ai.maxSnapshotChars,
    scope: opts.scope,
    limit: 400,
  });

  log.info(`captured ${snapshot.candidates.length} candidate element(s) from ${snapshot.url}`);

  const fallbackName = opts.name ?? nameFromUrl(snapshot.url);
  let name = fallbackName;
  let description = snapshot.title;
  let elements: Record<string, LocatorDefinition>;

  if (opts.useAi === false) {
    elements = deterministicElements(snapshot);
    log.info(`deterministic extraction produced ${Object.keys(elements).length} element(s)`);
  } else {
    const ai = await aiElements(snapshot, fallbackName);
    if (ai) {
      name = opts.name ?? ai.name;
      description = ai.description;
      elements = ai.elements;
      log.ok(`AI extraction produced ${Object.keys(elements).length} named element(s)`);
    } else {
      log.warn('AI extraction unavailable — falling back to deterministic extraction');
      elements = deterministicElements(snapshot);
    }
  }

  // Keep the hash: SPA routes live there, and `meta.url` must round-trip
  // through `new URL(url, baseURL)` in `aiqa check`.
  const url = (() => {
    try {
      const parsed = new URL(snapshot.url);
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    } catch {
      return snapshot.url;
    }
  })();

  return {
    name,
    yaml: renderLocatorFile({ name, description, url }, elements),
    elementCount: Object.keys(elements).length,
    snapshot,
  };
}

/** Open a browser, navigate, scan, close. */
export async function scanUrl(opts: ScanOptions): Promise<ScanOutput> {
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ headless: !opts.headed });
    const context = await browser.newContext(
      opts.storageState ? { storageState: opts.storageState } : {},
    );
    const page = await context.newPage();
    await page.goto(opts.url, { waitUntil: 'domcontentloaded' });
    if (opts.setup) await opts.setup(page);
    if (opts.waitForSelector) {
      await page.locator(opts.waitForSelector).first().waitFor({ timeout: 15_000 });
    }
    // Give client-rendered pages a beat to settle before snapshotting.
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
    return await scanPage(page, opts);
  } finally {
    await browser?.close();
  }
}
