/**
 * Framework configuration.
 *
 * Resolution order (last wins): built-in defaults -> `aiqa.config.ts` at the
 * repo root -> environment variables. Env wins so CI can flip healing off, or
 * a single engineer can flip persistence on, without editing tracked files.
 */
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
// Loads `.env.<TEST_ENV>` then `.env`. Never import 'dotenv/config' here —
// see loadEnvFiles() for why the order matters.
import { loadEnvFiles } from '../../config/environments.js';

loadEnvFiles();

export interface AiqaConfig {
  /** Repo root. Everything else resolves relative to this. */
  rootDir: string;
  /** Directory holding `*.locators.yml` files. */
  locatorsDir: string;
  /** Where heal journals, caches and AI reports land. */
  artifactsDir: string;

  heal: {
    /** Master switch for the healing pipeline. */
    enabled: boolean;
    /** Write accepted heals back into the YAML source files. */
    persist: boolean;
    /** Minimum validated confidence before a heal is used at all. */
    minConfidence: number;
    /**
     * Floor for the deterministic tier. Lower than `minConfidence` because a
     * heuristic match must additionally be an unambiguous winner AND validate
     * against the live page before it is accepted.
     */
    heuristicMinScore: number;
    /** Minimum confidence before a heal is written back to YAML. */
    persistMinConfidence: number;
    /** Budget for one heal attempt, in ms. */
    timeoutMs: number;
    /** Max AI heal calls per test run. Guards against a runaway bill. */
    maxPerRun: number;
    /** Reuse a previous heal for the same element + DOM signature. */
    cache: boolean;
    /** Still fail the test even when healing succeeded (report-only mode). */
    strict: boolean;
  };

  analysis: {
    /** AI root-cause analysis of failures, run from the reporter. */
    enabled: boolean;
    maxFailures: number;
  };

  ai: {
    model: string;
    /** Cheaper model for high-volume, low-judgement work (DOM ranking). */
    fastModel: string;
    effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
    maxTokens: number;
    /** Hard ceiling on DOM characters sent in one request. */
    maxSnapshotChars: number;
  };

  /** `data-testid` by default; must match `playwright.config.ts`. */
  testIdAttribute: string;

  /** Console/network capture for richer debugging artifacts. */
  capture: {
    console: boolean;
    network: boolean;
    /** Only record failed/4xx/5xx requests to keep artifacts small. */
    networkFailuresOnly: boolean;
  };
}

const bool = (v: string | undefined, fallback: boolean): boolean => {
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'on', 'yes'].includes(v.toLowerCase());
};

const num = (v: string | undefined, fallback: number): number => {
  if (v === undefined || v.trim() === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const isCI = bool(process.env.CI, false);

function defaults(rootDir: string): AiqaConfig {
  return {
    rootDir,
    locatorsDir: path.join(rootDir, 'locators'),
    artifactsDir: path.join(rootDir, '.ai'),
    heal: {
      // Healing rescues a run; it must never silently mask drift in CI.
      // Locally it heals and writes back; in CI it heals but reports only.
      enabled: true,
      persist: !isCI,
      minConfidence: 0.7,
      heuristicMinScore: 0.45,
      persistMinConfidence: 0.85,
      timeoutMs: 45_000,
      maxPerRun: 25,
      cache: true,
      strict: false,
    },
    analysis: { enabled: isCI, maxFailures: 10 },
    ai: {
      model: 'claude-opus-5',
      fastModel: 'claude-haiku-4-5',
      effort: 'medium',
      maxTokens: 8000,
      maxSnapshotChars: 60_000,
    },
    testIdAttribute: 'data-testid',
    capture: { console: true, network: true, networkFailuresOnly: true },
  };
}

function applyEnv(cfg: AiqaConfig): AiqaConfig {
  const e = process.env;
  cfg.heal.enabled = bool(e.AI_HEAL, cfg.heal.enabled);
  cfg.heal.persist = bool(e.AI_HEAL_PERSIST, cfg.heal.persist);
  cfg.heal.strict = bool(e.AI_HEAL_STRICT, cfg.heal.strict);
  cfg.heal.cache = bool(e.AI_HEAL_CACHE, cfg.heal.cache);
  cfg.heal.minConfidence = num(e.AI_HEAL_MIN_CONFIDENCE, cfg.heal.minConfidence);
  cfg.heal.heuristicMinScore = num(e.AI_HEAL_MIN_SCORE, cfg.heal.heuristicMinScore);
  cfg.heal.maxPerRun = num(e.AI_HEAL_MAX_PER_RUN, cfg.heal.maxPerRun);
  cfg.analysis.enabled = bool(e.AI_ANALYSIS, cfg.analysis.enabled);
  if (e.AI_MODEL) cfg.ai.model = e.AI_MODEL;
  if (e.AI_FAST_MODEL) cfg.ai.fastModel = e.AI_FAST_MODEL;
  if (e.AI_EFFORT) cfg.ai.effort = e.AI_EFFORT as AiqaConfig['ai']['effort'];
  if (e.AI_LOCATORS_DIR) cfg.locatorsDir = path.resolve(cfg.rootDir, e.AI_LOCATORS_DIR);
  if (e.AI_TEST_ID_ATTRIBUTE) cfg.testIdAttribute = e.AI_TEST_ID_ATTRIBUTE;

  // No credentials, no AI. Degrade to the deterministic tiers rather than
  // throwing mid-run — fallbacks and heuristics still work fully offline.
  if (!hasCredentials()) cfg.analysis.enabled = false;
  return cfg;
}

/**
 * The SDK resolves credentials from ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN,
 * or an `ant auth login` profile on disk. Treat a profile as valid credentials.
 */
export function hasCredentials(): boolean {
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) return true;
  const home = process.env.HOME ?? '';
  return home !== '' && fs.existsSync(path.join(home, '.config', 'anthropic'));
}

function findRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 12; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return start;
}

let cached: AiqaConfig | undefined;

/** Synchronous config. Used by fixtures and the resolver on the hot path. */
export function getConfig(): AiqaConfig {
  if (cached) return cached;
  cached = applyEnv(defaults(findRoot(process.cwd())));
  return cached;
}

/**
 * Async variant that also merges `aiqa.config.ts` when present. The CLI and
 * the reporter use this; fixtures use the sync version.
 */
export async function loadConfig(): Promise<AiqaConfig> {
  const root = findRoot(process.cwd());
  let cfg = defaults(root);
  for (const name of ['aiqa.config.ts', 'aiqa.config.js', 'aiqa.config.mjs']) {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) continue;
    try {
      const mod = await import(pathToFileURL(file).href);
      const user = (mod.default ?? mod.config) as Partial<AiqaConfig> | undefined;
      if (user) cfg = deepMerge(cfg, user);
    } catch (err) {
      console.warn(`[aiqa] ignoring ${name}: ${(err as Error).message}`);
    }
    break;
  }
  cached = applyEnv(cfg);
  return cached;
}

function deepMerge<T>(base: T, patch: Partial<T>): T {
  const out = { ...base } as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (v === undefined) continue;
    const cur = out[k];
    const mergeable = (x: unknown) => !!x && typeof x === 'object' && !Array.isArray(x);
    out[k] = mergeable(cur) && mergeable(v)
      ? deepMerge(cur as Record<string, unknown>, v as Record<string, unknown>)
      : v;
  }
  return out as T;
}

/** Resolve a path inside the artifacts dir, creating parent dirs on demand. */
export function artifact(...segments: string[]): string {
  const cfg = getConfig();
  const p = path.join(cfg.artifactsDir, ...segments);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  return p;
}
