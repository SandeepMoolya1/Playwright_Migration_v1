/**
 * API-based fixture data, with guaranteed cleanup.
 *
 * Creating data over the API is faster and far more reliable than creating it
 * through the UI, and it keeps a test about the one thing it is testing.
 *
 * Two rules this module enforces rather than documents:
 *
 *   1. **A read-only environment is never written to.** Production smoke runs
 *      fail loudly if a test tries to seed, instead of quietly creating real
 *      records.
 *   2. **Everything created is cleaned up**, in reverse order, even when the
 *      test fails. Anything that cannot be deleted is reported with its run
 *      tag so it can be swept later.
 */
import type { APIRequestContext, APIResponse } from '@playwright/test';
import { assertWritable, type EnvironmentConfig } from '../../config/environments.js';
import { createLogger } from '../core/logger.js';
import { runTag } from './run.js';

const log = createLogger('seed');

/** One thing we made and are responsible for destroying. */
interface TrackedEntity {
  resource: string;
  id: string;
  /** Overrides the default `DELETE {resource}/{id}`. */
  remove?: () => Promise<void>;
}

export interface SeederOptions {
  env: EnvironmentConfig;
  request: APIRequestContext;
  /** Prepended to every relative path. Defaults to `env.apiURL`. */
  baseURL?: string;
}

export class NoApiConfiguredError extends Error {
  constructor(envName: string) {
    super(
      `Environment "${envName}" has no apiURL, so API seeding is unavailable.\n` +
        `  Either add apiURL to config/environments.ts, seed through the UI or\n` +
        `  app state (see src/data/app-state.ts), or skip this test:\n` +
        `    test.skip(!env.apiURL, 'needs an API to seed fixture data');`,
    );
    this.name = 'NoApiConfiguredError';
  }
}

export class Seeder {
  private readonly created: TrackedEntity[] = [];

  constructor(private readonly opts: SeederOptions) {}

  private get baseURL(): string {
    const url = this.opts.baseURL ?? this.opts.env.apiURL;
    if (!url) throw new NoApiConfiguredError(this.opts.env.name);
    return url.endsWith('/') ? url : `${url}/`;
  }

  private url(resource: string): string {
    return new URL(resource.replace(/^\//, ''), this.baseURL).toString();
  }

  private async ok(response: APIResponse, action: string): Promise<unknown> {
    if (response.ok()) {
      // 204 and friends have no body.
      const text = await response.text();
      return text ? JSON.parse(text) : undefined;
    }
    const body = (await response.text()).slice(0, 600);
    throw new Error(
      `${action} failed: ${response.status()} ${response.statusText()}\n` +
        `  ${response.url()}\n  ${body}`,
    );
  }

  /**
   * Create a resource and register it for cleanup.
   *
   * `idField` is the property holding the identifier in the response — most
   * APIs use `id`, some use `uuid` or `reference`.
   */
  async create<T extends Record<string, unknown>>(
    resource: string,
    body: unknown,
    opts: { idField?: string; remove?: (created: T) => Promise<void> } = {},
  ): Promise<T> {
    assertWritable(this.opts.env, `create ${resource}`);

    const response = await this.opts.request.post(this.url(resource), { data: body });
    const created = (await this.ok(response, `POST ${resource}`)) as T;

    const idField = opts.idField ?? 'id';
    const id = created?.[idField];
    if (id === undefined) {
      log.warn(
        `${resource}: response has no "${idField}" — it cannot be cleaned up automatically. ` +
          `Pass { idField } or { remove } to fix this.`,
      );
    } else {
      this.created.push({
        resource,
        id: String(id),
        remove: opts.remove ? () => opts.remove!(created) : undefined,
      });
    }

    log.debug(`created ${resource}/${String(id)}`);
    return created;
  }

  /** Register something created elsewhere so it still gets cleaned up. */
  track(resource: string, id: string, remove?: () => Promise<void>): void {
    this.created.push({ resource, id, remove });
  }

  async get<T>(resource: string, params?: Record<string, string | number>): Promise<T> {
    const response = await this.opts.request.get(this.url(resource), { params });
    return (await this.ok(response, `GET ${resource}`)) as T;
  }

  async patch<T>(resource: string, id: string, body: unknown): Promise<T> {
    assertWritable(this.opts.env, `update ${resource}`);
    const response = await this.opts.request.patch(this.url(`${resource}/${id}`), { data: body });
    return (await this.ok(response, `PATCH ${resource}/${id}`)) as T;
  }

  async remove(resource: string, id: string): Promise<void> {
    assertWritable(this.opts.env, `delete ${resource}`);
    const response = await this.opts.request.delete(this.url(`${resource}/${id}`));
    await this.ok(response, `DELETE ${resource}/${id}`);
  }

  /** How many entities are still outstanding. Useful in assertions. */
  get pending(): number {
    return this.created.length;
  }

  /**
   * Destroy everything created, newest first — children before parents, which
   * is what referential integrity requires.
   *
   * Never throws: a cleanup failure must not turn a passing test red, and
   * must not mask the real failure of a failing one. It logs loudly instead,
   * with the run tag, so the leftovers can be swept.
   */
  async cleanup(): Promise<void> {
    if (!this.created.length) return;
    if (this.opts.env.readOnly) return;

    const failures: string[] = [];

    for (const entity of [...this.created].reverse()) {
      try {
        if (entity.remove) await entity.remove();
        else {
          const response = await this.opts.request.delete(
            this.url(`${entity.resource}/${entity.id}`),
          );
          // A 404 means someone already removed it. That is success.
          if (!response.ok() && response.status() !== 404) {
            failures.push(`${entity.resource}/${entity.id} -> ${response.status()}`);
          }
        }
      } catch (err) {
        failures.push(`${entity.resource}/${entity.id} -> ${(err as Error).message}`);
      }
    }

    const cleaned = this.created.length - failures.length;
    this.created.length = 0;

    if (failures.length) {
      log.warn(
        `cleanup left ${failures.length} entit${failures.length === 1 ? 'y' : 'ies'} behind ` +
          `in "${this.opts.env.name}" tagged ${runTag()}:\n  ${failures.join('\n  ')}`,
      );
    } else {
      log.debug(`cleaned up ${cleaned} entit${cleaned === 1 ? 'y' : 'ies'}`);
    }
  }
}
