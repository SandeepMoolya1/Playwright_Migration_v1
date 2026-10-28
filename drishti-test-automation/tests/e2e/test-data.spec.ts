/**
 * Test data patterns.
 *
 * Demonstrates the three ways this framework gets an application into the
 * state a test needs, in order of preference:
 *
 *   1. Seed app state directly (storage/cookies) — instant, no UI.
 *   2. Seed over the API — for anything the backend owns.
 *   3. Drive the UI — only when getting there is the thing under test.
 *
 * Plus the two data sources: `dataset` (reference data that already exists in
 * this environment) and `data` (test-owned data, tagged with the run id).
 */
import { test, expect } from '../../src/fixtures/index.js';
import { seedTodos } from '../../src/data/app-state.js';
import { isQaGenerated, runTag, unique } from '../../src/data/run.js';

test.describe('test data', () => {
  test('seeds app state directly instead of clicking through the UI', async ({
    ui,
    state,
    data,
  }) => {
    // Three todos, two active and one done — without a single interaction.
    const todos = [
      data.todo({ title: 'active one' }),
      data.todo({ title: 'active two' }),
      data.todo({ title: 'already done', completed: true }),
    ];

    // Must happen before navigation: the app reads storage once at boot.
    await seedTodos(state, todos);
    await ui.goto('#/');

    await ui.expect('todo.todoItems').toHaveCount(3);
    await ui.expect('todo.counter').toContainText('2 items left');

    // The test is now free to be about filtering, which is its actual subject.
    await ui.click('todo.filterCompleted');
    await ui.expect('todo.todoItems').toHaveCount(1);
    await ui.expect('todo.todoTitles').toHaveText(['already done']);
  });

  test('uses reference data from the environment dataset', async ({ ui, state, dataset, env }) => {
    // `dataset` comes from data/default.json merged with data/<env>.json, so
    // the same test works against an environment whose seeded data differs.
    const seeded = dataset.todos.seed.map((t) => ({
      id: crypto.randomUUID(),
      title: t.title,
      completed: t.completed,
    }));

    await seedTodos(state, seeded);
    await ui.goto('#/');

    await ui.expect('todo.todoItems').toHaveCount(seeded.length);
    await ui.expect('todo.todoTitles').toHaveText(seeded.map((t) => t.title));

    const active = seeded.filter((t) => !t.completed).length;
    await ui.expect('todo.counter').toContainText(`${active} item`);

    // Environment metadata is available for branching on a real difference.
    expect(env.name).toBeTruthy();
    expect(env.baseURL.endsWith('/')).toBe(true);
  });

  test('test-owned data is tagged so it is never mistaken for real data', async ({
    ui,
    state,
    data,
  }) => {
    const todo = data.todo();

    // The factory tags generated values with the run id. In a shared
    // environment that makes leftovers attributable and sweepable, and it
    // guarantees this title cannot collide with anyone else's.
    expect(isQaGenerated(todo.title)).toBe(true);
    expect(todo.title).toContain(runTag());

    await seedTodos(state, [todo]);
    await ui.goto('#/');

    await ui.expect('todo.todoTitles').toHaveText([todo.title]);
  });

  test('a feature flag changes expectations, not the test', async ({ ui, state, data, env }) => {
    await seedTodos(state, data.todos(2));
    await ui.goto('#/');

    // Branch on the flag rather than forking the spec per environment.
    if (env.features.newCheckout) {
      await ui.expect('todo.toggleAll').toBeVisible();
    } else {
      await ui.expect('todo.todoItems').toHaveCount(2);
    }
  });

  test('stubbing is for states a real backend cannot easily produce', async ({ ui, state }) => {
    // An E2E test that stubs its backend no longer proves the integration
    // works — so use it deliberately, for conditions like this one.
    await state.stub('**/api/unavailable', { status: 503, json: { error: 'maintenance' } });
    await ui.goto('#/');

    // Note: `page.route` intercepts requests made *by the page*. Requests made
    // through `page.request` (an APIRequestContext) bypass it, which is the
    // usual reason a stub appears not to work.
    const result = await ui.page.evaluate(async () => {
      const res = await fetch('/api/unavailable');
      return { status: res.status, body: await res.json() };
    });

    expect(result.status).toBe(503);
    expect(result.body).toEqual({ error: 'maintenance' });
  });

  test.describe('API seeding', () => {
    // Guarded rather than assumed: an environment with no API, or a read-only
    // one, skips with a stated reason instead of failing obscurely.
    // `tests/e2e/api-seeding.spec.ts` covers the seeder's full contract.
    test('creates and cleans up fixture data over the API', async ({ seed, data, env }) => {
      test.skip(!env.apiURL, 'this environment has no apiURL to seed against');
      test.skip(env.readOnly, `"${env.name}" is read-only; seeding is blocked by design`);

      // Its own collection: the fixture API is shared and tests run in
      // parallel, so a global `todos` would couple this test to its neighbours.
      const resource = unique('todos').replace(/[^a-zA-Z0-9-]/g, '');
      const created = await seed.create<{ id: string; title: string }>(resource, data.todo());

      expect(created.id).toBeTruthy();
      expect(seed.pending).toBe(1);

      // No cleanup code here: the `seed` fixture deletes everything it
      // created in its teardown, in reverse order, even if this test fails.
    });
  });
});
