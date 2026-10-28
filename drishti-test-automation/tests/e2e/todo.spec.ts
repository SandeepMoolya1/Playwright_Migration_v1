/**
 * Example suite: the framework's normal, everyday style.
 *
 * Note that no selector appears anywhere in this file. Elements are referred
 * to by key, and the framework resolves them through `locators/todo.locators.yml`.
 */
import { test, expect } from '../../src/fixtures/index.js';
import { TodoPage } from '../../src/pages/todo.page.js';

test.describe('TodoMVC', () => {
  let todo: TodoPage;

  test.beforeEach(async ({ ui }) => {
    todo = new TodoPage(ui);
    await todo.open('#/');
  });

  // Tagged @smoke: read-only, creates nothing, and safe to run against a
  // production environment. The nightly prod job selects on this tag.
  test('the application loads and is usable @smoke', async ({ ui }) => {
    await ui.expect('todo.heading').toBeVisible();
    await ui.expect('todo.newTodoInput').toBeVisible();
    await ui.expect('todo.newTodoInput').toBeEnabled();
  });

  test('adds a todo', async () => {
    await test.step('add one item', async () => {
      await todo.add('buy milk');
    });

    await todo.expectCount(1);
    await todo.expectTitles(['buy milk']);
    await todo.expectRemaining(1);
  });

  test('adds several todos and keeps their order', async () => {
    await todo.addMany(['write tests', 'review PR', 'ship it']);

    await todo.expectCount(3);
    await todo.expectTitles(['write tests', 'review PR', 'ship it']);
    await todo.expectRemaining(3);
  });

  test('completes a todo and clears it', async () => {
    await todo.addMany(['keep this', 'finish this']);

    await test.step('complete one item', async () => {
      await todo.complete('finish this');
    });
    await todo.expectRemaining(1);

    await test.step('clear completed', async () => {
      await todo.clearCompleted();
    });
    await todo.expectTitles(['keep this']);
  });

  test('filters by status', async ({ ui }) => {
    await todo.addMany(['active one', 'done one']);
    await todo.complete('done one');

    await ui.click('todo.filterActive');
    await todo.expectTitles(['active one']);

    await ui.click('todo.filterCompleted');
    await todo.expectTitles(['done one']);

    await ui.click('todo.filterAll');
    await todo.expectCount(2);
  });

  test('marks everything complete at once', async ({ ui }) => {
    await todo.addMany(['one', 'two', 'three']);

    await todo.completeAll();

    // `ui.expect` is the web-first assertion surface, keyed by locator name.
    await ui.expect('todo.clearCompleted').toBeVisible();
    await expect(await ui.locator('todo.counter')).toContainText('0 items left');
  });
});
