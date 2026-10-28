/**
 * Page preconditions for `aiqa check`.
 *
 * Many elements only exist once the application is in a particular state: a
 * cart needs an item, a footer needs a todo, an error banner needs a failed
 * submit. Without a way to express that, `aiqa check` reports every one of
 * them as broken and the report is worthless.
 *
 * A locator file opts in by naming a state in its `meta`:
 *
 *   meta:
 *     name: todo
 *     url: "#/"
 *     state: seeded
 *
 * The matching function below runs after navigation and before probing.
 * Use it for fixture data and for logging in — not for assertions.
 */
import type { Page } from '@playwright/test';

const setup: Record<string, (page: Page) => Promise<void>> = {
  /**
   * TodoMVC hides its list, counter, filters and "Clear completed" button
   * until at least one todo exists, and shows "Clear completed" only once one
   * is completed. Seed both so the whole page is probeable.
   */
  seeded: async (page) => {
    const input = page.getByPlaceholder('What needs to be done?');
    await input.fill('probe item');
    await input.press('Enter');
    await input.fill('completed probe item');
    await input.press('Enter');
    await page.getByTestId('todo-item').last().getByRole('checkbox').check();
  },
};

export default setup;
