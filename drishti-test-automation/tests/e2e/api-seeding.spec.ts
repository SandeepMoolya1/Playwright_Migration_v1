/**
 * Exercises the API seeding path against the bundled fixture API
 * (`tools/fixture-api.mjs`, started automatically by playwright.config.ts).
 *
 * These are the guarantees the `Seeder` makes, so they are tested rather than
 * asserted in a README:
 *
 *   - creates a resource and hands it back
 *   - deletes everything it created, in reverse order, in teardown
 *   - treats a 404 during cleanup as success (someone else got there first)
 *   - never throws from cleanup, so it cannot mask a test's real failure
 *   - refuses to write to a readOnly environment
 *   - says something useful when the environment has no API at all
 *
 * **Every test uses its own resource collection**, named with `unique()`.
 * The fixture API is a single shared server and these tests run in parallel,
 * so a shared `todos` collection would make each test's view of "what exists"
 * depend on its neighbours. Namespacing is the same discipline the framework
 * applies to fixture data everywhere else — and skipping it here is exactly
 * the bug that makes a suite pass alone and fail in CI.
 *
 * They run in the `local` environment only; any other environment points at a
 * real API that these tests have no business mutating.
 */
import { test, expect } from '../../src/fixtures/index.js';
import { Seeder, NoApiConfiguredError } from '../../src/data/seeder.js';
import { seedTodos } from '../../src/data/app-state.js';
import { unique } from '../../src/data/run.js';
import type { EnvironmentConfig } from '../../config/environments.js';

interface AuditEntry {
  action: 'create' | 'update' | 'delete' | 'delete-missing';
  resource: string;
  id: string;
}

interface Todo {
  id: string;
  title: string;
  completed: boolean;
}

/** A collection name no other test can be using. */
const collection = (): string => unique('todos').replace(/[^a-zA-Z0-9-]/g, '');

test.describe('API seeding', () => {
  // Only the bundled fixture API is safe to create and destroy data in.
  test.skip(
    ({ env }) => env.name !== 'local',
    'runs against the bundled fixture API, not a real environment',
  );

  /** Everything currently in one collection. */
  async function listAll(
    request: { get: (url: string) => Promise<{ json: () => Promise<unknown> }> },
    apiURL: string,
    resource: string,
  ): Promise<Todo[]> {
    const response = await request.get(new URL(resource, apiURL).toString());
    return (await response.json()) as Todo[];
  }

  /** The mutation log, narrowed to one collection. */
  async function auditFor(
    request: { get: (url: string) => Promise<{ json: () => Promise<unknown> }> },
    apiURL: string,
    resource: string,
  ): Promise<AuditEntry[]> {
    const response = await request.get(new URL('_audit', apiURL).toString());
    const entries = (await response.json()) as AuditEntry[];
    return entries.filter((e) => e.resource === resource);
  }

  test('creates fixture data over the API @smoke', async ({ seed, data, env }) => {
    const resource = collection();
    const created = await seed.create<Todo & Record<string, unknown>>(
      resource,
      data.todo({ title: 'seeded over http' }),
    );

    expect(created.id, 'the API should return an id').toBeTruthy();
    expect(created.title).toBe('seeded over http');
    expect(seed.pending, 'the created entity is registered for cleanup').toBe(1);

    // It really exists — a genuine HTTP round-trip, not a stub.
    const fetched = await seed.get<Todo>(`${resource}/${created.id}`);
    expect(fetched.id).toBe(created.id);
    expect(env.apiURL).toBeTruthy();

    // No cleanup code here: the `seed` fixture removes it in teardown.
  });

  test('reads, updates and deletes through the seeder', async ({ seed, data }) => {
    const resource = collection();
    const created = await seed.create<Todo & Record<string, unknown>>(resource, data.todo());

    const updated = await seed.patch<Todo>(resource, created.id, { completed: true });
    expect(updated.completed).toBe(true);

    const all = await seed.get<Todo[]>(resource);
    expect(all).toHaveLength(1);

    await seed.remove(resource, created.id);
    await expect(seed.get<Todo>(`${resource}/${created.id}`)).rejects.toThrow(/404/);
  });

  test('cleans up everything it created, newest first', async ({ request, data, env }) => {
    const resource = collection();

    // A Seeder owned by the test, so `cleanup()` can be called and observed.
    // The fixture version does exactly this in its teardown, where an
    // assertion could not reach it.
    const seeder = new Seeder({ env, request });

    const first = await seeder.create<Todo & Record<string, unknown>>(resource, data.todo());
    const second = await seeder.create<Todo & Record<string, unknown>>(resource, data.todo());
    const third = await seeder.create<Todo & Record<string, unknown>>(resource, data.todo());
    expect(seeder.pending).toBe(3);

    await seeder.cleanup();

    expect(seeder.pending, 'the registry is emptied after cleanup').toBe(0);
    expect(
      await listAll(request, env.apiURL!, resource),
      'nothing is left behind',
    ).toEqual([]);

    // Reverse order matters: children must be removed before their parents,
    // which is what referential integrity requires.
    const deletions = (await auditFor(request, env.apiURL!, resource))
      .filter((e) => e.action === 'delete')
      .map((e) => e.id);
    expect(deletions).toEqual([third.id, second.id, first.id]);
  });

  test('treats a 404 during cleanup as success', async ({ request, data, env }) => {
    const resource = collection();
    const seeder = new Seeder({ env, request });
    const todo = await seeder.create<Todo & Record<string, unknown>>(resource, data.todo());

    // Something else removed it first — a cascading delete, another job, a
    // developer poking at staging. That is not a cleanup failure.
    await request.delete(new URL(`${resource}/${todo.id}`, env.apiURL!).toString());

    await expect(seeder.cleanup()).resolves.toBeUndefined();

    const log = await auditFor(request, env.apiURL!, resource);
    expect(
      log.some((e) => e.action === 'delete-missing' && e.id === todo.id),
      'the seeder attempted the delete and accepted the 404',
    ).toBe(true);
  });

  test('cleanup never throws, so it cannot mask a real failure', async ({
    request,
    data,
    env,
  }) => {
    const resource = collection();
    const seeder = new Seeder({ env, request });
    await seeder.create<Todo & Record<string, unknown>>(resource, data.todo());

    // Register something whose removal is guaranteed to blow up. A failing
    // cleanup must be reported, never thrown — otherwise a passing test turns
    // red, and a failing one reports the wrong cause.
    seeder.track(resource, 'does-not-matter', async () => {
      throw new Error('simulated cleanup failure');
    });

    await expect(seeder.cleanup()).resolves.toBeUndefined();
    expect(seeder.pending).toBe(0);

    // The real entity was still removed despite the other one failing.
    expect(await listAll(request, env.apiURL!, resource)).toEqual([]);
  });

  test('refuses to write to a readOnly environment', async ({ request, data, env }) => {
    const resource = collection();
    const readOnlyEnv: EnvironmentConfig = { ...env, name: 'prod-like', readOnly: true };
    const seeder = new Seeder({ env: readOnlyEnv, request });

    await expect(seeder.create(resource, data.todo())).rejects.toThrow(
      /Refusing to create .* in "prod-like" — it is marked readOnly/,
    );

    // And it really did not reach the API.
    expect(await listAll(request, env.apiURL!, resource)).toEqual([]);
  });

  test('explains itself when the environment has no API', async ({ request, data, env }) => {
    const noApiEnv: EnvironmentConfig = { ...env, name: 'no-api', apiURL: undefined };
    const seeder = new Seeder({ env: noApiEnv, request });

    await expect(seeder.create('todos', data.todo())).rejects.toThrow(NoApiConfiguredError);
    await expect(seeder.create('todos', data.todo())).rejects.toThrow(
      /has no apiURL, so API seeding is unavailable/,
    );
  });

  test('surfaces the status and body when the API rejects a request', async ({ request, env }) => {
    const seeder = new Seeder({ env, request });
    const resource = collection();

    await expect(seeder.get(`${resource}/nope`)).rejects.toThrow(
      new RegExp(`GET ${resource}/nope failed: 404`),
    );
  });

  test('seeded data is usable by the UI layer', async ({ seed, data, ui, state }) => {
    // The point of API seeding: arrive at the screen under test with the data
    // already there. TodoMVC has no backend of its own, so this seeds through
    // the API and renders those same entities via app state.
    const resource = collection();
    for (const todo of [data.todo({ title: 'from api one' }), data.todo({ title: 'from api two' })]) {
      await seed.create(resource, todo);
    }

    const stored = await seed.get<Todo[]>(resource);
    expect(stored).toHaveLength(2);

    await seedTodos(
      state,
      stored.map((t) => ({ id: t.id, title: t.title, completed: Boolean(t.completed) })),
    );
    await ui.goto('#/');

    await ui.expect('todo.todoTitles').toHaveText(['from api one', 'from api two']);
  });
});
