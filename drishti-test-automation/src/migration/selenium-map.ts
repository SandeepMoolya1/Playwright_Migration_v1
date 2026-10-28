/**
 * Selenium → framework mapping tables.
 *
 * Two jobs:
 *   1. Turn a Selenium locator into a `LocatorStep`, upgrading it where the
 *      upgrade is *provably* equivalent (a `linkText` really is a link with
 *      that accessible name; `//*[@id='x']` really is `#x`). Anything less
 *      certain is translated faithfully and flagged for review — a migration
 *      that silently guesses is worse than one that says what it is unsure of.
 *   2. Turn a Java statement into a `MigratedStep` on the `ui` surface, or
 *      mark it `unsupported` so it is emitted as a TODO rather than invented.
 */
import type { LocatorStep } from '../core/types.js';
import type { MigratedStep, SeleniumHow, SeleniumLocator } from './types.js';

/** How much we trust the translated locator. Drives the migration report. */
export type LocatorQuality = 'good' | 'fair' | 'poor';

export interface MappedLocator {
  steps: LocatorStep[];
  quality: LocatorQuality;
  /** Why it is not `good`, or what the upgrade was. */
  note?: string;
}

const cssEscape = (value: string): string => value.replace(/"/g, '\\"');

/* ------------------------------------------------------- XPath upgrades */

/**
 * XPath patterns that have an exact, safe equivalent. Only truly unambiguous
 * shapes are listed: a partial match here would silently change what the test
 * selects, which is the one outcome a migration must never produce.
 */
function upgradeXPath(xpath: string, testIdAttribute: string): MappedLocator | undefined {
  const x = xpath.trim();

  // //*[@id='foo']  |  //div[@id="foo"]
  let m = /^\/\/(\*|[a-zA-Z][\w-]*)\[@id\s*=\s*['"]([^'"]+)['"]\]$/.exec(x);
  if (m) {
    const tag = m[1] === '*' ? '' : m[1]!;
    return {
      steps: [{ strategy: 'css', selector: `${tag}#${m[2]}` }],
      quality: 'fair',
      note: `upgraded from XPath "${x}"`,
    };
  }

  // //*[@data-testid='foo']
  m = new RegExp(
    `^//(\\*|[a-zA-Z][\\w-]*)\\[@${testIdAttribute}\\s*=\\s*['"]([^'"]+)['"]\\]$`,
  ).exec(x);
  if (m) {
    return {
      steps: [{ strategy: 'testId', text: m[2] }],
      quality: 'good',
      note: `upgraded from XPath "${x}"`,
    };
  }

  // //input[@name='q']  — any single attribute predicate
  m = /^\/\/(\*|[a-zA-Z][\w-]*)\[@([\w-]+)\s*=\s*['"]([^'"]+)['"]\]$/.exec(x);
  if (m) {
    const tag = m[1] === '*' ? '' : m[1]!;
    return {
      steps: [{ strategy: 'css', selector: `${tag}[${m[2]}="${cssEscape(m[3]!)}"]` }],
      quality: 'fair',
      note: `upgraded from XPath "${x}"`,
    };
  }

  // //button[text()='Save']  |  //a[normalize-space()="Next"]
  m = /^\/\/([a-zA-Z][\w-]*)\[(?:text\(\)|normalize-space\(\)|normalize-space\(text\(\)\))\s*=\s*['"]([^'"]+)['"]\]$/.exec(x);
  if (m) {
    const role = TAG_ROLES[m[1]!.toLowerCase()];
    if (role) {
      return {
        steps: [{ strategy: 'role', role: role as LocatorStep['role'], name: m[2], exact: true }],
        quality: 'good',
        note: `upgraded from XPath "${x}"`,
      };
    }
    return {
      steps: [{ strategy: 'text', text: m[2], exact: true }],
      quality: 'fair',
      note: `upgraded from XPath "${x}"`,
    };
  }

  // //*[contains(text(),'Save')]
  m = /^\/\/(\*|[a-zA-Z][\w-]*)\[contains\((?:text\(\)|\.)\s*,\s*['"]([^'"]+)['"]\)\]$/.exec(x);
  if (m) {
    return {
      steps: [{ strategy: 'text', text: m[2], exact: false }],
      quality: 'fair',
      note: `upgraded from XPath "${x}"`,
    };
  }

  return undefined;
}

/** Tags whose implicit ARIA role is unambiguous enough to rely on. */
const TAG_ROLES: Record<string, string> = {
  a: 'link',
  button: 'button',
  h1: 'heading',
  h2: 'heading',
  h3: 'heading',
  h4: 'heading',
  h5: 'heading',
  h6: 'heading',
};

/* --------------------------------------------------------- CSS upgrades */

function upgradeCss(selector: string, testIdAttribute: string): MappedLocator | undefined {
  const s = selector.trim();

  // [data-testid="foo"] or [data-testid='foo']
  const m = new RegExp(`^\\[${testIdAttribute}\\s*=\\s*['"]?([^'"\\]]+)['"]?\\]$`).exec(s);
  if (m) {
    return {
      steps: [{ strategy: 'testId', text: m[1] }],
      quality: 'good',
      note: `recognised the test-id attribute`,
    };
  }
  return undefined;
}

/** Selectors that depend on styling or position — flagged, never rejected. */
function cssQuality(selector: string): { quality: LocatorQuality; note?: string } {
  if (/\bcss-[a-z0-9]{5,}|\b[a-z]+-[a-f0-9]{6,}\b|\bng-tns-|\bMui[A-Z]/.test(selector)) {
    return { quality: 'poor', note: 'depends on a generated class name' };
  }
  if ((selector.match(/nth-(of-type|child)/g) ?? []).length >= 2) {
    return { quality: 'poor', note: 'deep positional selector' };
  }
  if (/^\s*(div|span)[.#\[ ]/.test(selector) && !/\[data-/.test(selector)) {
    return { quality: 'fair', note: 'structural selector on a generic element' };
  }
  return { quality: 'fair' };
}

/* ------------------------------------------------------ the entry point */

/** Translate one Selenium locator into a framework locator chain. */
export function mapLocator(
  locator: SeleniumLocator,
  testIdAttribute = 'data-testid',
): MappedLocator {
  const { how, value } = locator;

  switch (how) {
    case 'id':
      return {
        steps: [{ strategy: 'css', selector: `#${value}` }],
        quality: 'fair',
        note: 'an id is stable but carries no semantics — prefer a test id or role',
      };

    case 'name':
      return {
        steps: [{ strategy: 'css', selector: `[name="${cssEscape(value)}"]` }],
        quality: 'fair',
      };

    case 'className': {
      // Selenium's By.className takes exactly one class; a space is a bug in
      // the original test that Playwright would silently reinterpret.
      const classes = value.trim().split(/\s+/);
      const selector = classes.map((c) => `.${c}`).join('');
      const { quality, note } = cssQuality(selector);
      return {
        steps: [{ strategy: 'css', selector }],
        quality: quality === 'fair' ? 'poor' : quality,
        note:
          classes.length > 1
            ? 'By.className with multiple classes was invalid in Selenium — verify this'
            : (note ?? 'class names change with styling — prefer a test id or role'),
      };
    }

    case 'tagName':
      return {
        steps: [{ strategy: 'css', selector: value }],
        quality: 'poor',
        note: 'a bare tag almost never identifies one element',
      };

    case 'linkText':
      // Exactly equivalent: a link with that accessible name.
      return {
        steps: [{ strategy: 'role', role: 'link', name: value, exact: true }],
        quality: 'good',
        note: 'linkText maps exactly onto getByRole("link", { name })',
      };

    case 'partialLinkText':
      return {
        steps: [{ strategy: 'role', role: 'link', name: value, exact: false }],
        quality: 'good',
        note: 'partialLinkText maps onto a non-exact accessible-name match',
      };

    case 'css': {
      const upgraded = upgradeCss(value, testIdAttribute);
      if (upgraded) return upgraded;
      const { quality, note } = cssQuality(value);
      return { steps: [{ strategy: 'css', selector: value }], quality, note };
    }

    case 'xpath': {
      const upgraded = upgradeXPath(value, testIdAttribute);
      if (upgraded) return upgraded;
      return {
        steps: [{ strategy: 'xpath', selector: value }],
        quality: 'poor',
        note: 'XPath could not be upgraded automatically — rewrite by hand or run `aiqa migrate --url`',
      };
    }

    default:
      return {
        steps: [{ strategy: 'css', selector: value }],
        quality: 'poor',
        note: `unrecognised Selenium strategy "${String(how)}"`,
      };
  }
}

/** `By.id("x")` / `By.cssSelector("y")` → a `SeleniumLocator`. */
export const BY_METHODS: Record<string, SeleniumHow> = {
  id: 'id',
  name: 'name',
  cssSelector: 'css',
  css: 'css',
  xpath: 'xpath',
  className: 'className',
  class: 'className',
  linkText: 'linkText',
  partialLinkText: 'partialLinkText',
  tagName: 'tagName',
};

/** `@FindBy(how = How.ID, using = "x")` → a `SeleniumHow`. */
export const HOW_ENUM: Record<string, SeleniumHow> = {
  ID: 'id',
  NAME: 'name',
  CSS: 'css',
  XPATH: 'xpath',
  CLASS_NAME: 'className',
  LINK_TEXT: 'linkText',
  PARTIAL_LINK_TEXT: 'partialLinkText',
  TAG_NAME: 'tagName',
  ID_OR_NAME: 'id',
};

/* ------------------------------------------------- statement → ui step */

/** Java string literal → a TypeScript-safe literal. */
export function javaLiteralToTs(raw: string): string {
  const trimmed = raw.trim();
  // A quoted string: re-quote as a single-quoted TS string.
  const str = /^"((?:[^"\\]|\\.)*)"$/.exec(trimmed);
  if (str) return `'${str[1]!.replace(/\\"/g, '"').replace(/'/g, "\\'")}'`;
  // Keys.ENTER → 'Enter'
  const key = /^Keys\.([A-Z_]+)$/.exec(trimmed);
  if (key) return `'${keyName(key[1]!)}'`;
  // Numbers and booleans pass through.
  if (/^-?\d+(\.\d+)?$/.test(trimmed) || /^(true|false)$/.test(trimmed)) return trimmed;
  // Anything else is an expression (a variable, a method call) — pass it
  // through so the generated code fails to compile loudly rather than
  // silently doing the wrong thing.
  return trimmed;
}

/** Selenium `Keys.*` → Playwright key names. */
function keyName(seleniumKey: string): string {
  const map: Record<string, string> = {
    ENTER: 'Enter',
    RETURN: 'Enter',
    TAB: 'Tab',
    ESCAPE: 'Escape',
    ESC: 'Escape',
    SPACE: 'Space',
    BACK_SPACE: 'Backspace',
    DELETE: 'Delete',
    ARROW_DOWN: 'ArrowDown',
    ARROW_UP: 'ArrowUp',
    ARROW_LEFT: 'ArrowLeft',
    ARROW_RIGHT: 'ArrowRight',
    PAGE_DOWN: 'PageDown',
    PAGE_UP: 'PageUp',
    HOME: 'Home',
    END: 'End',
    CONTROL: 'Control',
    SHIFT: 'Shift',
    ALT: 'Alt',
  };
  return map[seleniumKey] ?? seleniumKey;
}

/**
 * Constructs that have no faithful equivalent and must not be guessed at.
 * Each produces a `TODO` in the generated spec and a warning in the report.
 */
export const UNSUPPORTED_PATTERNS: Array<{ re: RegExp; code: string; message: string }> = [
  {
    re: /JavascriptExecutor|executeScript|executeAsyncScript/,
    code: 'js-executor',
    message:
      'JavaScript execution. Playwright can usually do this natively — re-express it as a real interaction, or use page.evaluate() deliberately.',
  },
  {
    re: /new\s+Actions\s*\(/,
    code: 'actions-chain',
    message:
      'Actions chain (drag, hover sequence, key chord). Rewrite with ui.dragTo / ui.hover / page.keyboard.',
  },
  {
    re: /switchTo\s*\(\s*\)\s*\.\s*frame/,
    code: 'iframe',
    message: 'Frame switch. Declare `frame:` on the locator in YAML instead.',
  },
  {
    re: /switchTo\s*\(\s*\)\s*\.\s*(window|alert)/,
    code: 'window-or-alert',
    message:
      'Window/alert handling. Use page.on("dialog") or context.waitForEvent("page").',
  },
  {
    re: /getScreenshotAs|TakesScreenshot/,
    code: 'screenshot',
    message: 'Screenshot. Playwright captures these automatically on failure; use ui.screenshot(name) if you need one inline.',
  },
  {
    re: /Robot\s*\(|awt\./,
    code: 'awt-robot',
    message: 'java.awt.Robot native input. There is no equivalent — rethink the scenario.',
  },
  {
    re: /manage\s*\(\s*\)\s*\.\s*timeouts\s*\(\s*\)\s*\.\s*implicitlyWait/,
    code: 'implicit-wait',
    message:
      'Implicit wait. Playwright auto-waits on every action; delete this and rely on web-first assertions.',
  },
  {
    re: /manage\s*\(\s*\)\s*\.\s*window\s*\(\s*\)/,
    code: 'window-size',
    message: 'Window sizing. Set `viewport` in playwright.config.ts instead.',
  },
  {
    re: /getWindowHandles?|Cookie\s+\w+\s*=|manage\s*\(\s*\)\s*\.\s*addCookie/,
    code: 'browser-state',
    message: 'Cookie/window handling. Use the `state` fixture (setCookies, presetLocalStorage).',
  },
];

/**
 * Page-object helper methods, as found on a typical Selenium `BasePage`
 * (`clickOnElement(by)`, `enterTextOnElement(by, text)`, ...). A call maps to
 * a `ui` action only when its first argument is a declared element; `value`
 * is the index of the argument carrying the text or option.
 */
export const HELPER_CALLS: Record<string, { kind: MigratedStep['kind']; value?: number; note?: string }> = {
  clickOnElement: { kind: 'click' },
  clickJsUsingBy: { kind: 'click', note: 'was a JavaScript click — a real click is stricter; if it is intercepted, find out what covers the element' },
  clickJsUsingWebElement: { kind: 'click', note: 'was a JavaScript click' },
  scrollAndClickUsingJS: { kind: 'click', note: 'was scroll + JavaScript click; Playwright scrolls into view itself' },
  clickElementUsingAction: { kind: 'click', note: 'was an Actions click' },
  enterTextOnElement: { kind: 'fill', value: 1 },
  clearText: { kind: 'clear' },
  hoverOnElement: { kind: 'hover' },
  selectFromDropDown: { kind: 'selectOption', value: 1 },
  waitForPresenceOfElement: { kind: 'expectVisible' },
  waitUntilElementIsDisplayed: { kind: 'expectVisible' },
  waitForInvisibilityOfElement: { kind: 'expectHidden' },
  waitForInvisibilityOfLocator: { kind: 'expectHidden' },
  waitForElementToDisappear: { kind: 'expectHidden' },
};

/**
 * Helpers that only compensate for Selenium's lack of auto-waiting or
 * auto-scrolling. They are dropped, leaving a comment where they stood: the
 * next action or web-first assertion waits for the same condition. If a step
 * turns out flaky at that point, assert the state the wait was for.
 */
export const DROPPED_HELPERS: Record<string, string> = {
  waitFor: 'fixed wait dropped — the next action/assertion auto-waits',
  waitForPageLoad: 'page-load wait dropped — Playwright waits for navigation',
  waitForNetworkIdle: 'network-idle wait dropped — assert the content instead',
  waitForSpinnerIfPresent: 'spinner wait dropped — the next assertion retries',
  waitForLoadingSpinner: 'spinner wait dropped — the next assertion retries',
  waitForLoadingSpinnerIfPresent: 'spinner wait dropped — the next assertion retries',
  waitForInvisibilityOfLoadingSpinner: 'spinner wait dropped — the next assertion retries',
  waitUntilInvisibilityOfLoadingSpinner: 'spinner wait dropped — the next assertion retries',
  scrollTillElement: 'scroll dropped — Playwright scrolls into view before acting',
  scrollToElement: 'scroll dropped — Playwright scrolls into view before acting',
  scrollIntoView: 'scroll dropped — Playwright scrolls into view before acting',
  highlightElement: 'debug highlight dropped',
};

/** A `Thread.sleep` is always wrong in the target framework. */
export const SLEEP_MESSAGE =
  'Thread.sleep is a hard wait. Replace it with a web-first assertion on the condition it was waiting for — ui.expect(key).toBeVisible() and friends retry.';

/** Build a step, keeping the original line for traceability. */
export function step(
  kind: MigratedStep['kind'],
  source: string,
  line: number,
  extra: Partial<MigratedStep> = {},
): MigratedStep {
  return { kind, args: [], source: source.trim(), line, ...extra };
}
