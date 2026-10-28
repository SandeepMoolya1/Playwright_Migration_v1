/**
 * Per-environment reference data.
 *
 * There are two kinds of test data, and conflating them is the usual cause of
 * a suite that only passes in one environment:
 *
 *   1. REFERENCE data — things that already exist in the environment and that
 *      the test refers to: a known SKU, a seeded promo code, a search term
 *      with predictable results. It differs per environment. That is what
 *      this module provides.
 *
 *   2. TEST-OWNED data — created by the test, for the test, and cleaned up
 *      afterwards. It must be unique per run so parallel workers and
 *      concurrent CI jobs cannot collide. See `factory.ts` and `seeder.ts`.
 *
 * `data/default.json` holds the shared shape; `data/<env>.json` overrides only
 * the keys that genuinely differ. The result is validated, so a typo in a
 * dataset fails immediately with a path, rather than as a confusing assertion
 * failure twenty steps into a test.
 */
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { getEnvironment } from '../../config/environments.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('data');

/**
 * The dataset contract. Extend this as your application grows — every field
 * you add here becomes type-safe and autocompleted in tests, and any
 * environment missing it fails loudly at load time instead of at assert time.
 */
export const datasetSchema = z.object({
  todos: z.object({
    seed: z
      .array(
        z.object({
          title: z.string().min(1),
          completed: z.boolean().default(false),
        }),
      )
      .min(1),
    longTitle: z.string(),
  }),
  search: z.object({
    knownTerm: z.string(),
    noResultsTerm: z.string(),
  }),
  checkout: z.object({
    validPromoCode: z.string(),
    expiredPromoCode: z.string(),
    expectedDiscountPercent: z.number(),
  }),
});

export type Dataset = z.infer<typeof datasetSchema>;

function readJson(file: string): Record<string, unknown> {
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`Invalid JSON in ${file}: ${(err as Error).message}`);
  }
}

/** Environment overrides win, key by key, at any depth. */
function deepMerge(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (key.startsWith('_')) continue; // `_comment` and friends are not data
    const current = out[key];
    const mergeable = (x: unknown) => !!x && typeof x === 'object' && !Array.isArray(x);
    out[key] =
      mergeable(current) && mergeable(value)
        ? deepMerge(current as Record<string, unknown>, value as Record<string, unknown>)
        : value;
  }
  return out;
}

const cache = new Map<string, Dataset>();

/**
 * Load the dataset for an environment. Cached per process.
 *
 * @param envName defaults to the current `TEST_ENV`.
 */
export function getDataset(envName?: string): Dataset {
  const name = envName ?? getEnvironment().name;
  const cached = cache.get(name);
  if (cached) return cached;

  const dir = path.join(process.cwd(), 'data');
  const merged = deepMerge(readJson(path.join(dir, 'default.json')), readJson(path.join(dir, `${name}.json`)));

  const parsed = datasetSchema.safeParse(merged);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `    - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(
      `Dataset for environment "${name}" is invalid:\n${issues}\n` +
        `  Fix data/default.json or data/${name}.json, or update datasetSchema in src/data/dataset.ts.`,
    );
  }

  log.debug(`loaded dataset for "${name}"`);
  cache.set(name, parsed.data);
  return parsed.data;
}

export function resetDatasetCache(): void {
  cache.clear();
}
