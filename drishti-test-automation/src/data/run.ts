/**
 * Run identity.
 *
 * Every entity a test creates is tagged with the run that created it. That
 * single convention solves three problems at once:
 *
 *   - **Collision.** Parallel workers, and two CI jobs against the same
 *     shared environment, never fight over the same record.
 *   - **Attribution.** When something is left behind in staging, the tag says
 *     which run created it.
 *   - **Cleanup.** A sweeper can delete everything matching an old run tag,
 *     even after the run that created it crashed.
 *
 * The id is generated once in `global-setup.ts` and exported through the
 * environment, so every worker in a run shares it.
 */
import { randomUUID } from 'node:crypto';

const ENV_VAR = 'AIQA_RUN_ID';

/** Short, sortable, filename-safe. e.g. `r6k2p9-4f7a`. */
function generate(): string {
  const stamp = Date.now().toString(36);
  const rand = randomUUID().slice(0, 4);
  return `r${stamp}-${rand}`;
}

/**
 * The id for this run. Stable across workers because `global-setup.ts` sets
 * the variable before any worker starts; falls back to a fresh id so the
 * helpers still work in a standalone script or a single `tsx` invocation.
 */
export function runId(): string {
  let id = process.env[ENV_VAR];
  if (!id) {
    id = generate();
    process.env[ENV_VAR] = id;
  }
  return id;
}

/** Called once by global setup. */
export function initRunId(): string {
  const id = generate();
  process.env[ENV_VAR] = id;
  return id;
}

/**
 * The marker embedded in created data, e.g. `[qa:r6k2p9-4f7a]`.
 *
 * Deliberately bracketed and prefixed so it is greppable in a database, and
 * obviously machine-generated to anyone who stumbles across it in a UI.
 */
export function runTag(): string {
  return `[qa:${runId()}]`;
}

/** Does this string belong to a run created by this framework? */
export function isQaGenerated(value: string): boolean {
  return /\[qa:r[a-z0-9]+-[a-f0-9]{4}\]/.test(value);
}

/** Extract the run id from a tagged value, if present. */
export function runIdOf(value: string): string | undefined {
  return /\[qa:(r[a-z0-9]+-[a-f0-9]{4})\]/.exec(value)?.[1];
}

let counter = 0;

/**
 * A value unique within this run. Includes the worker index so two workers
 * cannot produce the same id from their own counters.
 */
export function unique(prefix = 'id'): string {
  const worker = process.env.TEST_WORKER_INDEX ?? '0';
  counter += 1;
  return `${prefix}-${runId()}-w${worker}-${counter}`;
}

/** An email address that is unique per run and safely non-deliverable. */
export function uniqueEmail(local = 'qa'): string {
  const worker = process.env.TEST_WORKER_INDEX ?? '0';
  counter += 1;
  return `${local}+${runId()}-w${worker}-${counter}@example.com`;
}
