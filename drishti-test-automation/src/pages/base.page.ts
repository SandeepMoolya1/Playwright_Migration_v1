/**
 * Page-object base class.
 *
 * Page objects here hold *behaviour*, never selectors — selectors live in
 * YAML. A page object's job is to express the journeys a page supports
 * ("login as", "add a todo") in terms of declared element keys.
 *
 *   export class LoginPage extends BasePage {
 *     constructor(ui: SmartPage) { super(ui, 'login'); }
 *
 *     async loginAs(user: string, password: string) {
 *       await this.fill('usernameInput', user);
 *       await this.fill('passwordInput', password);
 *       await this.click('submitButton');
 *     }
 *   }
 */
import type { Locator } from '@playwright/test';
import type { SmartPage } from '../fixtures/smart-page.js';

export abstract class BasePage {
  protected constructor(
    protected readonly ui: SmartPage,
    /** Locator namespace — the `meta.name` of this page's YAML file. */
    protected readonly namespace: string,
  ) {}

  /** `submitButton` -> `login.submitButton` */
  protected key(element: string): string {
    return element.includes('.') ? element : `${this.namespace}.${element}`;
  }

  get page() {
    return this.ui.page;
  }

  /* --------------------------------------------------------- navigation */

  /** Override in subclasses that know their own path. */
  async open(path?: string): Promise<void> {
    if (path) await this.ui.goto(path);
  }

  /* ------------------------------------------------------------ actions */

  protected locator(element: string, opts?: { timeout?: number }): Promise<Locator> {
    return this.ui.locator(this.key(element), opts);
  }

  protected click(element: string, opts?: { timeout?: number }) {
    return this.ui.click(this.key(element), opts);
  }

  protected fill(element: string, value: string, opts?: { timeout?: number }) {
    return this.ui.fill(this.key(element), value, opts);
  }

  protected type(element: string, value: string, opts?: { delay?: number }) {
    return this.ui.type(this.key(element), value, opts);
  }

  protected press(element: string, keys: string) {
    return this.ui.press(this.key(element), keys);
  }

  protected check(element: string) {
    return this.ui.check(this.key(element));
  }

  protected uncheck(element: string) {
    return this.ui.uncheck(this.key(element));
  }

  protected select(element: string, value: string | string[]) {
    return this.ui.selectOption(this.key(element), value);
  }

  protected hover(element: string) {
    return this.ui.hover(this.key(element));
  }

  /* ------------------------------------------------------------ queries */

  protected textOf(element: string): Promise<string> {
    return this.ui.textOf(this.key(element));
  }

  protected valueOf(element: string): Promise<string> {
    return this.ui.valueOf(this.key(element));
  }

  protected countOf(element: string): Promise<number> {
    return this.ui.count(this.key(element));
  }

  protected isVisible(element: string): Promise<boolean> {
    return this.ui.isVisible(this.key(element));
  }

  /* --------------------------------------------------------- assertions */

  /** Public so specs can assert on a page object: `await todo.expect('input').toBeVisible()` */
  expect(element: string, opts?: { timeout?: number }) {
    return this.ui.expect(this.key(element), opts);
  }
}
