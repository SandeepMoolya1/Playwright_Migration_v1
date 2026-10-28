/**
 * Example page object for the TodoMVC demo.
 *
 * Note what is *not* here: no selectors. Every element is a key into
 * `locators/todo.locators.yml`, which is what lets the framework heal,
 * audit and regenerate them independently of this file.
 */
import { expect } from '@playwright/test';
import { BasePage } from './base.page.js';
import type { SmartPage } from '../fixtures/smart-page.js';

export class TodoPage extends BasePage {
  constructor(ui: SmartPage) {
    super(ui, 'todo');
  }

  override async open(path = '#/'): Promise<void> {
    await this.ui.goto(path);
    await this.expect('newTodoInput').toBeVisible();
  }

  /** Type a todo and submit it. */
  async add(title: string): Promise<void> {
    await this.fill('newTodoInput', title);
    await this.press('newTodoInput', 'Enter');
  }

  async addMany(titles: string[]): Promise<void> {
    for (const title of titles) await this.add(title);
  }

  /** Complete a todo by its visible title. */
  async complete(title: string): Promise<void> {
    const items = await this.locator('todoItems');
    await items.filter({ hasText: title }).getByRole('checkbox').check();
  }

  async completeAll(): Promise<void> {
    await this.check('toggleAll');
  }

  async clearCompleted(): Promise<void> {
    await this.click('clearCompleted');
  }

  async titles(): Promise<string[]> {
    const titles = await this.locator('todoTitles');
    return titles.allInnerTexts();
  }

  async remaining(): Promise<number> {
    const text = await this.textOf('counter');
    return Number.parseInt(text, 10);
  }

  /* --------------------------------------------------------- assertions */

  async expectTitles(expected: string[]): Promise<void> {
    const titles = await this.locator('todoTitles');
    await expect(titles).toHaveText(expected);
  }

  async expectCount(n: number): Promise<void> {
    await this.expect('todoItems').toHaveCount(n);
  }

  async expectRemaining(n: number): Promise<void> {
    await this.expect('counter').toContainText(`${n} item`);
  }
}
