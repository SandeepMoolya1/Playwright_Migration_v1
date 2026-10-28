/**
 * `aiqa` subcommand implementations.
 *
 * The CLI exists so that the AI capabilities are usable outside a test run:
 * building the locator repository, proactively checking it against a
 * deployed environment, generating a spec, and re-analysing a CI failure
 * bundle without re-running anything.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Page } from '@playwright/test';
import {
  currentEnvName,
  ENVIRONMENT_NAMES,
  getEnvironment,
  getEnvironmentByName,
} from '../../config/environments.js';
import { getDataset } from '../data/dataset.js';
import { getConfig, hasCredentials, loadConfig } from '../core/config.js';
import { createLogger } from '../core/logger.js';
import { getRepository, resetRepository } from '../locators/repository.js';
import { buildDefinition, explain } from '../locators/resolver.js';
import { describeSteps } from '../locators/schema.js';
import { persistHeal } from '../locators/writer.js';
import { capturePage } from '../dom/snapshot.js';
import { hasClearWinner, rankCandidates } from '../dom/candidates.js';
import { scanUrl } from '../ai/scanner.js';
import { generateTest } from '../ai/generator.js';
import { analyzeFailure, renderAnalysisReport, type DiagnosticsPayload } from '../ai/analyzer.js';
import { usageSummary } from '../ai/client.js';
import type { FailureAnalysis, HealRecord, LocatorStep } from '../core/types.js';

const log = createLogger('aiqa');

/* --------------------------------------------------------------- scan */

export async function cmdScan(args: {
  url: string;
  name?: string;
  out?: string;
  headed?: boolean;
  noAi?: boolean;
  scope?: string;
  storageState?: string;
  waitFor?: string;
}): Promise<number> {
  const cfg = await loadConfig();
  log.info(`scanning ${args.url}`);

  const result = await scanUrl({
    url: args.url,
    name: args.name,
    useAi: !args.noAi,
    headed: args.headed,
    scope: args.scope,
    storageState: args.storageState,
    waitForSelector: args.waitFor,
  });

  const outPath =
    args.out ?? path.join(cfg.locatorsDir, `${result.name}.locators.yml`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  if (fs.existsSync(outPath)) {
    const backup = `${outPath}.bak`;
    fs.copyFileSync(outPath, backup);
    log.warn(`${path.basename(outPath)} existed — previous version saved to ${path.basename(backup)}`);
  }

  fs.writeFileSync(outPath, result.yaml, 'utf8');
  log.ok(`wrote ${result.elementCount} element(s) to ${path.relative(process.cwd(), outPath)}`);
  log.info(`AI usage: ${usageSummary()}`);
  return 0;
}

/* ---------------------------------------------------------------- gen */

export async function cmdGen(args: {
  goal: string;
  url: string;
  out?: string;
  name?: string;
  headed?: boolean;
  maxSteps?: number;
  storageState?: string;
}): Promise<number> {
  const cfg = await loadConfig();
  if (!hasCredentials()) {
    log.error('test generation requires Anthropic credentials (ANTHROPIC_API_KEY or `ant auth login`).');
    return 1;
  }

  const generated = await generateTest({
    goal: args.goal,
    url: args.url,
    name: args.name,
    headed: args.headed,
    maxSteps: args.maxSteps,
    storageState: args.storageState,
  });

  if (!generated) {
    log.error('generation produced no output');
    return 1;
  }

  const specDir = args.out ?? path.join(cfg.rootDir, 'tests', 'e2e');
  fs.mkdirSync(specDir, { recursive: true });

  const specPath = path.join(specDir, generated.fileName);
  writeIfSafe(specPath, generated.spec);
  log.ok(`spec written to ${path.relative(process.cwd(), specPath)}`);

  if (generated.locatorFile) {
    const locPath = path.join(cfg.locatorsDir, `${generated.locatorFile.name}.locators.yml`);
    fs.mkdirSync(path.dirname(locPath), { recursive: true });
    writeIfSafe(locPath, generated.locatorFile.yaml);
    log.ok(`locators written to ${path.relative(process.cwd(), locPath)}`);
  }

  if (generated.pageObject) {
    const poPath = path.join(cfg.rootDir, 'src', 'pages', generated.pageObject.fileName);
    fs.mkdirSync(path.dirname(poPath), { recursive: true });
    writeIfSafe(poPath, generated.pageObject.code);
    log.ok(`page object written to ${path.relative(process.cwd(), poPath)}`);
  }

  if (generated.notes) log.info(`notes: ${generated.notes}`);
  log.info(`AI usage: ${usageSummary()}`);
  log.warn('Generated tests are a starting point. Review the assertions before committing.');
  return 0;
}

/** Never silently clobber an engineer's file. */
function writeIfSafe(file: string, content: string): void {
  if (fs.existsSync(file)) {
    fs.copyFileSync(file, `${file}.bak`);
    log.warn(`${path.basename(file)} existed — previous version saved alongside as .bak`);
  }
  fs.writeFileSync(file, content, 'utf8');
}

/* -------------------------------------------------------------- check */

interface CheckResult {
  key: string;
  status: 'ok' | 'healed' | 'broken' | 'skipped';
  detail: string;
  healedTo?: LocatorStep[];
}

/**
 * Probe every locator in the repository against a live environment.
 *
 * This is the command that turns healing from a runtime rescue into a
 * maintenance tool: run it against staging after a UI release and fix the
 * whole repository before a single test fails.
 */
export async function cmdCheck(args: {
  baseUrl: string;
  fix?: boolean;
  only?: string;
  headed?: boolean;
  storageState?: string;
}): Promise<number> {
  const cfg = await loadConfig();
  resetRepository();
  const repo = getRepository();

  const setups = await loadSetups(cfg.rootDir);

  // Group by (url, state): elements on the same page in the same precondition
  // can all be probed from one navigation.
  const groups = new Map<string, { url: string; state?: string; keys: string[] }>();
  for (const key of repo.keys()) {
    if (args.only && !key.startsWith(args.only)) continue;
    const element = repo.get(key);
    const url = element.meta.url;
    if (!url) {
      log.warn(`${key}: file has no meta.url — cannot check. Add one to enable \`aiqa check\`.`);
      continue;
    }
    const state = element.meta.state;
    const id = `${url}::${state ?? ''}`;
    const group = groups.get(id) ?? { url, state, keys: [] };
    group.keys.push(key);
    groups.set(id, group);
  }

  if (!groups.size) {
    log.error('nothing to check. Locator files need a `meta.url` to be checkable.');
    return 1;
  }

  const browser = await chromium.launch({ headless: !args.headed });
  const results: CheckResult[] = [];

  try {
    for (const { url, state, keys } of groups.values()) {
      const full = new URL(url, args.baseUrl).toString();
      log.info(`checking ${keys.length} locator(s) on ${full}${state ? ` [state: ${state}]` : ''}`);

      // A fresh context per group so one group's fixture data cannot leak
      // into the next one's probe.
      const context = await browser.newContext(
        args.storageState ? { storageState: args.storageState } : {},
      );
      const page = await context.newPage();

      try {
        await page.goto(full, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined);

        if (state) {
          const setup = setups[state];
          if (!setup) {
            log.warn(`unknown state "${state}" — add it to aiqa.setup.ts. Probing without it.`);
          } else {
            await setup(page);
          }
        }

        for (const key of keys) {
          results.push(await checkOne(page, key, Boolean(args.fix)));
        }
      } catch (err) {
        const reason = (err as Error).message.split('\n')[0];
        for (const key of keys) {
          results.push({ key, status: 'skipped', detail: `page setup failed: ${reason}` });
        }
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  return reportCheck(results, Boolean(args.fix), cfg.locatorsDir);
}

/** Load the optional `aiqa.setup.ts` precondition map. */
async function loadSetups(
  rootDir: string,
): Promise<Record<string, (page: Page) => Promise<void>>> {
  for (const name of ['aiqa.setup.ts', 'aiqa.setup.js', 'aiqa.setup.mjs']) {
    const file = path.join(rootDir, name);
    if (!fs.existsSync(file)) continue;
    try {
      const mod = await import(pathToFileURL(file).href);
      return (mod.default ?? mod.setup ?? {}) as Record<string, (page: Page) => Promise<void>>;
    } catch (err) {
      log.warn(`could not load ${name}: ${(err as Error).message}`);
    }
    break;
  }
  return {};
}

async function checkOne(page: Page, key: string, fix: boolean): Promise<CheckResult> {
  const repo = getRepository();
  const element = repo.get(key);
  const def = element.definition;

  try {
    const locator = buildDefinition(page, def);
    await locator.first().waitFor({ state: 'attached', timeout: 4_000 });
    const collection = def.multiple === true || def.index !== undefined;
    const count = collection ? 1 : await locator.count();
    if (count > 1) {
      return {
        key,
        status: 'broken',
        detail: `ambiguous — matches ${count} elements (add \`multiple: true\` if this is a list)`,
      };
    }
    return { key, status: 'ok', detail: explain(def) };
  } catch {
    // Broken. Try to find it the same way the runtime healer would.
    const snapshot = await capturePage(page, { testIdAttribute: element.meta.testIdAttribute });
    const ranked = rankCandidates(element.element, def, snapshot.candidates);
    const cfg = getConfig();

    if (hasClearWinner(ranked, cfg.heal.heuristicMinScore)) {
      const best = ranked[0]!;
      try {
        const probe = buildDefinition(page, def, best.steps);
        await probe.first().waitFor({ state: 'attached', timeout: 2_000 });
        if (fix) {
          persistHeal({
            sourcePath: element.sourcePath,
            element: element.element,
            previous: def,
            healedSteps: best.steps,
          });
        }
        return {
          key,
          status: 'healed',
          detail: `${explain(def)} -> ${describeSteps(best.steps)} (${Math.round(best.score * 100)}%)`,
          healedTo: best.steps,
        };
      } catch {
        /* fall through to broken */
      }
    }

    // Distinguish the two very different failures: the element is not on this
    // page at all, versus several elements look equally plausible.
    const detail = ranked.length === 0
      ? `not present on this page: ${explain(def)}`
      : `no unambiguous match for ${explain(def)} — best candidate ` +
        `<${ranked[0]!.candidate.tag}> role=${ranked[0]!.candidate.role} ` +
        `name="${ranked[0]!.candidate.name}" scored ${ranked[0]!.score.toFixed(2)}`;
    return { key, status: 'broken', detail };
  }
}

function reportCheck(results: CheckResult[], fixed: boolean, locatorsDir: string): number {
  const ok = results.filter((r) => r.status === 'ok');
  const healed = results.filter((r) => r.status === 'healed');
  const broken = results.filter((r) => r.status === 'broken');
  const skipped = results.filter((r) => r.status === 'skipped');

  process.stdout.write('\n');
  for (const r of healed) process.stdout.write(`  DRIFTED  ${r.key}\n           ${r.detail}\n`);
  for (const r of broken) process.stdout.write(`  BROKEN   ${r.key}\n           ${r.detail}\n`);
  for (const r of skipped) process.stdout.write(`  SKIPPED  ${r.key}  (${r.detail})\n`);

  process.stdout.write(
    `\n  ${ok.length} ok · ${healed.length} drifted · ${broken.length} broken · ${skipped.length} skipped\n`,
  );

  if (healed.length && !fixed) {
    process.stdout.write(`\n  Re-run with --fix to write the drifted locators back into ${path.relative(process.cwd(), locatorsDir)}.\n`);
  } else if (healed.length && fixed) {
    process.stdout.write(`\n  ${healed.length} locator(s) updated on disk. Review the diff before committing.\n`);
  }
  process.stdout.write('\n');

  return broken.length > 0 ? 1 : 0;
}

/* -------------------------------------------------------------- audit */

/**
 * Static quality review of the locator repository. No browser, no AI —
 * just the rules this framework says make a durable locator.
 */
export async function cmdAudit(): Promise<number> {
  await loadConfig();
  resetRepository();
  const repo = getRepository();
  const keys = repo.keys();

  if (!keys.length) {
    log.error('no locators found.');
    return 1;
  }

  interface Issue { key: string; severity: 'high' | 'medium' | 'low'; message: string }
  const issues: Issue[] = [];
  const bySignature = new Map<string, string[]>();

  for (const key of keys) {
    const { definition: def } = repo.get(key);

    if (!def.description) {
      issues.push({ key, severity: 'medium', message: 'no description — AI healing has no intent to match against' });
    }

    const signature = JSON.stringify(def.steps);
    bySignature.set(signature, [...(bySignature.get(signature) ?? []), key]);

    for (const step of def.steps) {
      if (step.strategy === 'xpath') {
        issues.push({ key, severity: 'high', message: `XPath selector "${step.selector}" — prefer a role or test id` });
      }
      if (step.strategy === 'css' && step.selector) {
        const sel = step.selector;
        if (/\bcss-[a-z0-9]{5,}|\b[a-z]+-[a-f0-9]{6,}\b|\bng-tns-/.test(sel)) {
          issues.push({ key, severity: 'high', message: `selector depends on a generated class: "${sel}"` });
        }
        if ((sel.match(/nth-(of-type|child)/g) ?? []).length >= 2) {
          issues.push({ key, severity: 'high', message: `deep positional selector: "${sel}"` });
        }
        if (/^\s*(div|span)[.#\[ ]/.test(sel) && !/\[data-/.test(sel)) {
          issues.push({ key, severity: 'low', message: `structural selector on a generic element: "${sel}"` });
        }
      }
      if (step.strategy === 'text' && step.text && /\d{2,}|[$£€]|\d{4}-\d{2}-\d{2}/.test(step.text)) {
        issues.push({ key, severity: 'medium', message: `text match looks dynamic: "${step.text}"` });
      }
    }

    const hasDurablePrimary = def.steps.some((s) => s.strategy === 'testId' || s.strategy === 'role');
    if (!hasDurablePrimary && !def.fallbacks?.length) {
      issues.push({ key, severity: 'medium', message: 'no test id or role, and no fallbacks declared' });
    }

    if (def.healedAt) {
      issues.push({ key, severity: 'low', message: `healed on ${def.healedAt.slice(0, 10)} (was ${def.healedFrom}) — confirm it is correct` });
    }
  }

  for (const [, dupes] of bySignature) {
    if (dupes.length > 1) {
      issues.push({ key: dupes.join(', '), severity: 'low', message: 'identical locator declared more than once' });
    }
  }

  const order = { high: 0, medium: 1, low: 2 } as const;
  issues.sort((a, b) => order[a.severity] - order[b.severity]);

  process.stdout.write(`\n  Locator audit — ${keys.length} element(s) across ${repo.namespaces().length} file(s)\n\n`);
  if (!issues.length) {
    process.stdout.write('  No issues found.\n\n');
    return 0;
  }
  for (const i of issues) {
    process.stdout.write(`  [${i.severity.toUpperCase().padEnd(6)}] ${i.key}\n             ${i.message}\n`);
  }
  const high = issues.filter((i) => i.severity === 'high').length;
  process.stdout.write(`\n  ${issues.length} issue(s), ${high} high severity.\n\n`);
  return high > 0 ? 1 : 0;
}

/* --------------------------------------------------------------- list */

export async function cmdList(args: { json?: boolean }): Promise<number> {
  await loadConfig();
  resetRepository();
  const repo = getRepository();

  if (args.json) {
    const out = repo.keys().map((key) => {
      const e = repo.get(key);
      return { key, file: path.relative(process.cwd(), e.sourcePath), locator: explain(e.definition), description: e.definition.description };
    });
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
    return 0;
  }

  for (const ns of repo.namespaces()) {
    const entry = repo.fileOf(ns);
    process.stdout.write(`\n  ${ns}  (${path.relative(process.cwd(), entry?.sourcePath ?? '')})\n`);
    if (entry?.file.meta.url) process.stdout.write(`    url: ${entry.file.meta.url}\n`);
    for (const key of repo.keys().filter((k) => k.startsWith(`${ns}.`))) {
      const def = repo.get(key).definition;
      process.stdout.write(`    ${key.slice(ns.length + 1).padEnd(28)} ${explain(def)}\n`);
      if (def.description) process.stdout.write(`      ${'`'.repeat(0)}${def.description}\n`);
    }
  }
  process.stdout.write(`\n  ${repo.keys().length} element(s) total.\n\n`);
  return 0;
}

/* ------------------------------------------------------------ explain */

/**
 * Re-run failure analysis from artifacts already on disk. Lets you diagnose
 * a CI failure locally from the downloaded report, without re-running tests.
 */
export async function cmdExplain(args: { input?: string }): Promise<number> {
  const cfg = await loadConfig();
  if (!hasCredentials()) {
    log.error('analysis requires Anthropic credentials.');
    return 1;
  }
  // Force analysis on for this invocation — it is the whole point of the command.
  cfg.analysis.enabled = true;

  const root = args.input ?? path.join(cfg.rootDir, 'test-results');
  const files = findFiles(root, 'ai-diagnostics.json');
  if (!files.length) {
    log.error(`no ai-diagnostics.json found under ${root}`);
    return 1;
  }

  log.info(`analysing ${files.length} failure bundle(s)`);
  const analyses: FailureAnalysis[] = [];

  for (const file of files.slice(0, cfg.analysis.maxFailures)) {
    const payload = JSON.parse(fs.readFileSync(file, 'utf8')) as DiagnosticsPayload;
    const analysis = await analyzeFailure({ ...payload });
    if (analysis) analyses.push(analysis);
  }

  const heals = readJournal(path.join(cfg.artifactsDir, 'heal-journal.jsonl'));
  const markdown = renderAnalysisReport(analyses, heals);
  const out = path.join(cfg.artifactsDir, 'report', 'analysis.md');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, markdown, 'utf8');

  process.stdout.write(`\n${markdown}\n`);
  log.ok(`written to ${path.relative(process.cwd(), out)}`);
  log.info(`AI usage: ${usageSummary()}`);
  return 0;
}

function readJournal(file: string): HealRecord[] {
  if (!fs.existsSync(file)) return [];
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as HealRecord);
  } catch {
    return [];
  }
}

function findFiles(dir: string, name: string, acc: string[] = []): string[] {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) findFiles(full, name, acc);
    else if (entry.name === name) acc.push(full);
  }
  return acc;
}

/* ------------------------------------------------------------ migrate */

/**
 * Convert an existing Selenium/Java suite — plain TestNG/JUnit or Cucumber
 * BDD — into this framework.
 *
 * Deterministic by default: nothing is written outside the output directory
 * unless `--apply` is passed, so the flow is migrate → read the report →
 * review the drafts → apply.
 */
export async function cmdMigrate(args: {
  input?: string;
  out?: string;
  apply?: boolean;
  url?: string;
  analyzeOnly?: boolean;
}): Promise<number> {
  const cfg = await loadConfig();
  const { resolveSeleniumSource, SeleniumPathError } = await import('../migration/source-path.js');
  let root: string;
  try {
    root = resolveSeleniumSource(args.input).root;
  } catch (e) {
    if (e instanceof SeleniumPathError) {
      log.error(e.message);
      return 1;
    }
    throw e;
  }

  const { analyse, migrate } = await import('../migration/index.js');

  if (args.analyzeOnly) {
    const inventory = analyse(root);
    const s = inventory.stats;
    process.stdout.write(
      `\n  ${s.files} Java file(s), ${s.pages} page object(s), ${s.testClasses} test class(es)\n` +
        `  ${s.tests} test(s), ${s.elements} element(s), ${s.steps} statement(s)\n` +
        (s.featureFiles
          ? `  ${s.featureFiles} feature file(s), ${s.scenarios} scenario(s), ` +
            `${s.stepDefinitions} step definition(s)\n`
          : '') +
        `  ${s.unsupportedSteps} statement(s) need a human\n` +
        (s.unmatchedGherkinSteps ? `  ${s.unmatchedGherkinSteps} Gherkin step(s) unbound\n` : '') +
        '\n',
    );
    return 0;
  }

  const outDir = path.resolve(args.out ?? path.join(cfg.rootDir, 'migration', 'output'));
  log.info(`migrating ${path.relative(process.cwd(), root)}`);

  const result = migrate({ root, outDir, apply: args.apply, url: args.url });
  const s = result.inventory.stats;

  const coverage = s.steps ? Math.round(((s.steps - s.unsupportedSteps) / s.steps) * 100) : 100;
  process.stdout.write(
    [
      '',
      `  ${result.locatorFiles.length} locator file(s), ${result.specFiles.length} spec(s), ` +
        `${result.pageObjects.length} page object(s)`,
      `  ${coverage}% of statements translated automatically`,
      s.featureFiles
        ? `  BDD: ${s.scenarios} scenario(s) from ${s.featureFiles} feature file(s), ` +
          `${s.gherkinSteps - s.unmatchedGherkinSteps}/${s.gherkinSteps} steps bound`
        : '',
      '',
      `  Report: ${path.relative(process.cwd(), path.join(outDir, 'MIGRATION-REPORT.md'))}`,
      args.apply
        ? '  Applied into locators/, tests/e2e/ and src/pages/.'
        : '  Review the drafts, then re-run with --apply to install them.',
      '',
    ]
      .filter((l) => l !== '')
      .join('\n') + '\n',
  );

  if (s.unsupportedSteps || s.unmatchedGherkinSteps) {
    log.warn(
      `${s.unsupportedSteps + s.unmatchedGherkinSteps} item(s) need a human — see the report.`,
    );
  }
  return 0;
}

/* --------------------------------------------------------------- envs */

/**
 * Show every configured environment and whether it is currently usable.
 *
 * Reading a lazy credential throws when its variable is unset, which is
 * exactly the signal we want here: it tells you what a run against that
 * environment would be missing, without running it.
 */
export async function cmdEnvs(): Promise<number> {
  const current = currentEnvName();

  process.stdout.write(`\n  Environments (current: ${current})\n\n`);

  for (const name of ENVIRONMENT_NAMES) {
    const env = getEnvironmentByName(name);
    const marker = name === current ? '*' : ' ';
    process.stdout.write(`  ${marker} ${name.padEnd(9)} ${env.label}\n`);
    process.stdout.write(`      baseURL   ${env.baseURL}\n`);
    if (env.apiURL) process.stdout.write(`      apiURL    ${env.apiURL}\n`);
    process.stdout.write(
      `      writes    ${env.readOnly ? 'BLOCKED (readOnly)' : 'allowed'}` +
        `   timeouts x${env.timeoutFactor}\n`,
    );

    const flags = Object.entries(env.features)
      .map(([k, v]) => `${k}=${v}`)
      .join(' ');
    if (flags) process.stdout.write(`      features  ${flags}\n`);

    const roles = Object.keys(env.users);
    if (roles.length) {
      const status = roles.map((role) => {
        try {
          // Touching the getter resolves the secret, or throws.
          void env.users[role]!.username;
          return `${role}: ok`;
        } catch {
          return `${role}: MISSING SECRET`;
        }
      });
      process.stdout.write(`      users     ${status.join('  ')}\n`);
    } else {
      process.stdout.write(`      users     (none — no auth setup project)\n`);
    }

    try {
      const dataset = getDataset(name);
      process.stdout.write(
        `      dataset   ok (${dataset.todos.seed.length} seed todo(s), ` +
          `promo "${dataset.checkout.validPromoCode}")\n`,
      );
    } catch (err) {
      process.stdout.write(`      dataset   INVALID — ${(err as Error).message.split('\n')[0]}\n`);
    }
    process.stdout.write('\n');
  }

  process.stdout.write(
    `  Select one with --env <name> or TEST_ENV=<name>. Defined in config/environments.ts.\n\n`,
  );
  return 0;
}

/* ------------------------------------------------------------- doctor */

export async function cmdDoctor(): Promise<number> {
  const cfg = await loadConfig();
  // 'warn' is for things that reduce capability but do not break the
  // framework — missing credentials only disables the AI tiers.
  type Status = 'ok' | 'warn' | 'fail';
  const rows: Array<[string, string, Status]> = [];

  rows.push(['Node', process.version, Number(process.versions.node.split('.')[0]) >= 22 ? 'ok' : 'fail']);

  let env;
  try {
    env = getEnvironment();
    rows.push(['Environment', `${env.name} — ${env.label}`, 'ok']);
    rows.push(['Base URL', env.baseURL, 'ok']);
    rows.push(['API URL', env.apiURL ?? '(none — API seeding unavailable)', env.apiURL ? 'ok' : 'warn']);
    rows.push(['Writes', env.readOnly ? 'BLOCKED (readOnly)' : 'allowed', 'ok']);
  } catch (err) {
    rows.push(['Environment', (err as Error).message.split('\n')[0] ?? 'unknown error', 'fail']);
  }

  if (env) {
    try {
      const dataset = getDataset(env.name);
      rows.push(['Dataset', `valid (${dataset.todos.seed.length} seed todo(s))`, 'ok']);
    } catch (err) {
      rows.push(['Dataset', (err as Error).message.split('\n')[0] ?? 'unknown error', 'fail']);
    }
  }

  rows.push(['Locators dir', cfg.locatorsDir, fs.existsSync(cfg.locatorsDir) ? 'ok' : 'fail']);

  resetRepository();
  let count = 0;
  let repoOk = true;
  try {
    count = getRepository().keys().length;
  } catch (err) {
    repoOk = false;
    rows.push(['Locator parse', (err as Error).message, 'fail']);
  }
  if (repoOk) rows.push(['Locators loaded', `${count} element(s)`, count > 0 ? 'ok' : 'warn']);

  const creds = hasCredentials();
  rows.push([
    'Anthropic credentials',
    creds
      ? 'found'
      : 'missing — AI tiers disabled; fallbacks and the heuristic matcher still work',
    creds ? 'ok' : 'warn',
  ]);
  rows.push(['AI model', cfg.ai.model, 'ok']);
  rows.push(['Healing', cfg.heal.enabled ? `on (persist: ${cfg.heal.persist})` : 'off', 'ok']);
  rows.push(['Failure analysis', cfg.analysis.enabled ? 'on' : 'off', 'ok']);

  let browsersOk = true;
  try {
    const browser = await chromium.launch({ headless: true });
    rows.push(['Chromium', browser.version(), 'ok']);
    await browser.close();
  } catch (err) {
    browsersOk = false;
    rows.push([
      'Chromium',
      `not installed — run \`npx playwright install\` (${(err as Error).message.split('\n')[0]})`,
      'fail',
    ]);
  }

  process.stdout.write('\n  aiqa doctor\n\n');
  const badge = { ok: 'ok  ', warn: 'warn', fail: 'FAIL' } as const;
  for (const [label, value, status] of rows) {
    process.stdout.write(`  ${badge[status]}  ${label.padEnd(22)} ${value}\n`);
  }
  process.stdout.write('\n');

  // Warnings never fail the command: the deterministic tiers work without
  // credentials, and `doctor` is used in CI as a smoke check.
  return repoOk && browsersOk ? 0 : 1;
}
