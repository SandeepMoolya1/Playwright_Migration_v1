/**
 * Proves the healing cascade end to end.
 *
 * `locators/todo-drift.locators.yml` declares locators that are all wrong, in
 * the ways real locators break: a renamed test id, dead CSS classes, and a
 * button label that changed. Their descriptions are accurate.
 *
 * The test asserts that the framework still drives the app — and that it
 * reports the healing rather than hiding it.
 *
 * These heals are recovered by the deterministic heuristic tier, so this suite
 * passes with no credentials and no network access. That is the point: the AI
 * tier is the last resort, not the first.
 *
 * Note on test isolation: an accepted heal is applied to the in-memory
 * repository for the rest of the worker, so an element only heals once no
 * matter how many tests use it. Each test below therefore exercises its own
 * element.
 */
import { test, expect } from '../../src/fixtures/index.js';
import { getConfig } from '../../src/core/config.js';

/** These tests need a heal to happen; with AI_HEAL=off they cannot apply. */
const HEALING_OFF = !getConfig().heal.enabled;

/** Mirrors `heal.heuristicMinScore` — the floor the deterministic tier uses. */
const HEURISTIC_FLOOR = 0.45;

test.describe('locator auto-healing', () => {
  test.beforeEach(async ({ ui }) => {
    await ui.goto('#/');
  });

  test('heals a stale test id and drives the app', async ({ ui, heals }) => {
    test.skip(HEALING_OFF, 'healing is disabled (AI_HEAL=off) — run with AI_HEAL=on to exercise it');
    // `todoDrift.newTodoInput` points at "#new-todo-input-v2-renamed", which
    // does not exist. The description says what the field is for, and the
    // healer finds the real one.
    await ui.fill('todoDrift.newTodoInput', 'healed todo');
    await ui.press('todoDrift.newTodoInput', 'Enter');

    await ui.expect('todoDrift.todoItems').toHaveCount(1);

    const healed = heals.find((h) => h.key === 'todoDrift.newTodoInput');
    expect(healed, 'the broken input should have been healed').toBeDefined();

    // The replacement must be a durable locator, not another brittle CSS path:
    // the framework rebuilds from test id / role+name in that order.
    const step = healed!.healedWith[0]!;
    expect(['testId', 'role', 'label', 'placeholder']).toContain(step.strategy);
    expect(`${step.name ?? step.text ?? ''}`).toContain('What needs to be done');
  });

  test('records what it healed, with provenance', async ({ ui, heals }) => {
    test.skip(HEALING_OFF, 'healing is disabled (AI_HEAL=off) — run with AI_HEAL=on to exercise it');
    await ui.fill('todoDrift.newTodoInputLegacy', 'first');
    await ui.press('todoDrift.newTodoInputLegacy', 'Enter');
    await ui.expect('todoDrift.counter').toContainText('1 item');

    expect(heals.length, 'both broken locators should have healed').toBeGreaterThan(0);

    for (const heal of heals) {
      // Every heal is auditable: what broke, what replaced it, how sure we
      // are, and which tier produced it.
      expect(heal.failedWith).toBeTruthy();
      expect(heal.healedWith.length).toBeGreaterThan(0);
      expect(heal.confidence).toBeGreaterThanOrEqual(HEURISTIC_FLOOR);
      expect(['fallback', 'heuristic', 'ai']).toContain(heal.source);
      expect(heal.url).toContain('todomvc');
    }

    // No credentials are needed for this suite — assert we stayed offline.
    expect(
      heals.every((h) => h.source !== 'ai'),
      'these heals must not require an API call',
    ).toBe(true);
  });

  test('a well-maintained locator file never heals', async ({ ui, heals }) => {
    // `todo.*` locators are all accurate, so nothing should heal at all.
    await ui.fill('todo.newTodoInput', 'no healing needed');
    await ui.press('todo.newTodoInput', 'Enter');
    await ui.expect('todo.todoItems').toHaveCount(1);
    await ui.expect('todo.counter').toContainText('1 item');

    expect(heals.filter((h) => h.key.startsWith('todo.'))).toHaveLength(0);
  });

  test('a genuinely absent element still fails, loudly', async ({ ui }) => {
    // Healing must never invent a match. `todoDrift.ghostWidget` describes
    // something this app has never had, so every tier should decline and the
    // framework should fail with an actionable error rather than silently
    // acting on the wrong control.
    const error = await ui
      .click('todoDrift.ghostWidget', { timeout: 1_000 })
      .then(() => null, (err: Error) => err);

    expect(error, 'clicking a non-existent element must not succeed').not.toBeNull();
    expect(error!.message).toContain('todoDrift.ghostWidget');
    expect(error!.message).toContain('Attempted');
  });
});
