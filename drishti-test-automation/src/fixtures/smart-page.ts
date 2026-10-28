/**
 * `ui` — the action surface tests actually use.
 *
 * Every method takes a locator *key* (`"login.submitButton"`), never a
 * selector. That indirection is what makes healing, auditing and codegen
 * possible: the framework always knows which declared element an action
 * belongs to.
 *
 * Each action is wrapped in `test.step()` so the HTML report and the trace
 * read as a test case ("click login.submitButton") rather than as a list of
 * anonymous clicks.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { HealRecord } from '../core/types.js';

/** Resolves a locator key to a live locator, healing on the way if needed. */
export type Finder = (key: string, opts?: { timeout?: number }) => Promise<Locator>;

type ActionOptions = { timeout?: number; force?: boolean };

export class SmartPage {
  constructor(
    readonly page: Page,
    private readonly find: Finder,
    private readonly onHeal?: (record: HealRecord) => void,
  ) {}

  private step<T>(name: string, body: () => Promise<T>): Promise<T> {
    return test.step(name, body, { box: true });
  }

  /** Navigate, then settle. `path` may be relative to `baseURL`. */
  goto(path: string, opts?: { waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' }) {
    return this.step(`goto ${path}`, async () => {
      await this.page.goto(path, { waitUntil: opts?.waitUntil ?? 'domcontentloaded' });
    });
  }

  /** Escape hatch: the raw locator, already healed. */
  locator(key: string, opts?: { timeout?: number }): Promise<Locator> {
    return this.find(key, opts);
  }

  click(key: string, opts?: ActionOptions) {
    return this.step(`click ${key}`, async () => {
      const el = await this.find(key, opts);
      await el.click(opts);
    });
  }

  dblclick(key: string, opts?: ActionOptions) {
    return this.step(`dblclick ${key}`, async () => {
      await (await this.find(key, opts)).dblclick(opts);
    });
  }

  /** Clears first — `fill` on a dirty field is the classic flaky test. */
  fill(key: string, value: string, opts?: ActionOptions) {
    return this.step(`fill ${key}`, async () => {
      const el = await this.find(key, opts);
      await el.fill(value, opts);
    });
  }

  /** Character-by-character entry, for inputs with keystroke handlers. */
  type(key: string, value: string, opts?: ActionOptions & { delay?: number }) {
    return this.step(`type into ${key}`, async () => {
      const el = await this.find(key, opts);
      await el.click(opts);
      await el.pressSequentially(value, { delay: opts?.delay ?? 25 });
    });
  }

  press(key: string, keys: string, opts?: ActionOptions) {
    return this.step(`press ${keys} on ${key}`, async () => {
      await (await this.find(key, opts)).press(keys, opts);
    });
  }

  check(key: string, opts?: ActionOptions) {
    return this.step(`check ${key}`, async () => {
      await (await this.find(key, opts)).check(opts);
    });
  }

  uncheck(key: string, opts?: ActionOptions) {
    return this.step(`uncheck ${key}`, async () => {
      await (await this.find(key, opts)).uncheck(opts);
    });
  }

  selectOption(key: string, value: string | string[], opts?: ActionOptions) {
    return this.step(`select ${String(value)} in ${key}`, async () => {
      await (await this.find(key, opts)).selectOption(value, opts);
    });
  }

  hover(key: string, opts?: ActionOptions) {
    return this.step(`hover ${key}`, async () => {
      await (await this.find(key, opts)).hover(opts);
    });
  }

  setInputFiles(key: string, files: string | string[], opts?: ActionOptions) {
    return this.step(`upload to ${key}`, async () => {
      await (await this.find(key, opts)).setInputFiles(files, opts);
    });
  }

  dragTo(sourceKey: string, targetKey: string, opts?: ActionOptions) {
    return this.step(`drag ${sourceKey} -> ${targetKey}`, async () => {
      const source = await this.find(sourceKey, opts);
      const target = await this.find(targetKey, opts);
      await source.dragTo(target, opts);
    });
  }

  /* ----------------------------------------------------------- queries */

  async textOf(key: string, opts?: ActionOptions): Promise<string> {
    return (await (await this.find(key, opts)).innerText()).trim();
  }

  async valueOf(key: string, opts?: ActionOptions): Promise<string> {
    return (await this.find(key, opts)).inputValue();
  }

  async count(key: string, opts?: ActionOptions): Promise<number> {
    return (await this.find(key, opts)).count();
  }

  async isVisible(key: string, opts?: ActionOptions): Promise<boolean> {
    return (await this.find(key, opts)).isVisible();
  }

  /* -------------------------------------------------------- assertions */

  /**
   * Web-first assertions against a declared element. These retry, so they are
   * the correct alternative to `waitForTimeout` everywhere in this framework.
   */
  expect(key: string, opts?: { timeout?: number }) {
    const find = () => this.find(key, opts);
    const name = (what: string) => `expect ${key} ${what}`;

    return {
      toBeVisible: (o?: { timeout?: number }) =>
        this.step(name('to be visible'), async () => expect(await find()).toBeVisible(o)),
      toBeHidden: (o?: { timeout?: number }) =>
        this.step(name('to be hidden'), async () => expect(await find()).toBeHidden(o)),
      toBeEnabled: (o?: { timeout?: number }) =>
        this.step(name('to be enabled'), async () => expect(await find()).toBeEnabled(o)),
      toBeDisabled: (o?: { timeout?: number }) =>
        this.step(name('to be disabled'), async () => expect(await find()).toBeDisabled(o)),
      toBeChecked: (o?: { timeout?: number; checked?: boolean }) =>
        this.step(name('to be checked'), async () => expect(await find()).toBeChecked(o)),
      // `useInnerText` compares rendered text (CSS text-transform applied),
      // which is what Selenium's getText() returns.
      toHaveText: (
        value: string | RegExp | Array<string | RegExp>,
        o?: { timeout?: number; useInnerText?: boolean },
      ) => this.step(name('to have text'), async () => expect(await find()).toHaveText(value, o)),
      toContainText: (value: string | RegExp, o?: { timeout?: number; useInnerText?: boolean }) =>
        this.step(name('to contain text'), async () => expect(await find()).toContainText(value, o)),
      toHaveValue: (value: string | RegExp, o?: { timeout?: number }) =>
        this.step(name('to have value'), async () => expect(await find()).toHaveValue(value, o)),
      toHaveCount: (value: number, o?: { timeout?: number }) =>
        this.step(name('to have count'), async () => expect(await find()).toHaveCount(value, o)),
      toHaveAttribute: (attr: string, value: string | RegExp, o?: { timeout?: number }) =>
        this.step(name(`to have @${attr}`), async () =>
          expect(await find()).toHaveAttribute(attr, value, o),
        ),
    };
  }

  /** Assert the page URL. Kept here so tests never touch `page` directly. */
  expectUrl(value: string | RegExp, opts?: { timeout?: number }) {
    return this.step(`expect url ${String(value)}`, async () =>
      expect(this.page).toHaveURL(value, opts),
    );
  }

  expectTitle(value: string | RegExp, opts?: { timeout?: number }) {
    return this.step(`expect title ${String(value)}`, async () =>
      expect(this.page).toHaveTitle(value, opts),
    );
  }

  /** Named screenshot attached to the report. Useful inside long journeys. */
  screenshot(name: string) {
    return this.step(`screenshot ${name}`, async () => {
      const buffer = await this.page.screenshot({ fullPage: true });
      await test.info().attach(name, { body: buffer, contentType: 'image/png' });
    });
  }

  /** Surface a heal to any listener (the fixture uses this for reporting). */
  reportHeal(record: HealRecord): void {
    this.onHeal?.(record);
  }
}
