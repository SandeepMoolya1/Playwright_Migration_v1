/**
 * Page capture for healing and codegen.
 *
 * Two complementary views are produced:
 *
 *  1. `ariaSnapshot()` — Playwright's own accessibility tree, in YAML. Compact,
 *     semantic, and exactly what `getByRole` matches against. This is the
 *     primary context we give the model.
 *  2. `captureCandidates()` — a flat list of interactive/labelled elements with
 *     the raw attributes (`id`, test id, placeholder, classes) plus a
 *     ready-to-use unique CSS path. This is what a proposal gets validated
 *     against, and what the heuristic tier scores without any AI at all.
 *
 * Everything runs in one `page.evaluate` round-trip to keep healing fast.
 */
import type { Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import type { DomCandidate } from '../core/types.js';

export interface CaptureOptions {
  /** Attribute used by `getByTestId`. Mirrors the Playwright config. */
  testIdAttribute?: string;
  /** Cap on returned candidates; the most interactive elements win. */
  limit?: number;
  /** Include elements that are present but not visible. */
  includeHidden?: boolean;
}

export interface PageSnapshot {
  url: string;
  title: string;
  /** Playwright aria snapshot (YAML), trimmed to the configured budget. */
  aria: string;
  candidates: DomCandidate[];
  /** Stable hash of the page structure, used as a heal-cache key. */
  signature: string;
}

/**
 * Serialised into the browser. Must be fully self-contained — no imports,
 * no closure over Node-side variables beyond the single argument.
 */
/* c8 ignore start — executed in the browser, not under Node coverage */
function collectInPage(args: { testIdAttribute: string; limit: number; includeHidden: boolean }) {
  const { testIdAttribute, limit, includeHidden } = args;

  const IMPLICIT_ROLES: Record<string, string> = {
    a: 'link',
    button: 'button',
    h1: 'heading',
    h2: 'heading',
    h3: 'heading',
    h4: 'heading',
    h5: 'heading',
    h6: 'heading',
    img: 'img',
    input: 'textbox',
    select: 'combobox',
    textarea: 'textbox',
    table: 'table',
    tr: 'row',
    td: 'cell',
    th: 'columnheader',
    ul: 'list',
    ol: 'list',
    li: 'listitem',
    nav: 'navigation',
    main: 'main',
    header: 'banner',
    footer: 'contentinfo',
    form: 'form',
    dialog: 'dialog',
    summary: 'button',
    label: 'generic',
    p: 'paragraph',
    section: 'region',
  };

  const INPUT_TYPE_ROLES: Record<string, string> = {
    button: 'button',
    submit: 'button',
    reset: 'button',
    checkbox: 'checkbox',
    radio: 'radio',
    range: 'slider',
    number: 'spinbutton',
    search: 'searchbox',
    email: 'textbox',
    tel: 'textbox',
    url: 'textbox',
    text: 'textbox',
    password: 'textbox',
  };

  const norm = (s: string | null | undefined): string =>
    (s ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);

  function roleOf(el: Element): string {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit.split(/\s+/)[0] ?? 'generic';
    const tag = el.tagName.toLowerCase();
    if (tag === 'input') {
      const t = (el as HTMLInputElement).type?.toLowerCase() ?? 'text';
      return INPUT_TYPE_ROLES[t] ?? 'textbox';
    }
    if (tag === 'a') return el.hasAttribute('href') ? 'link' : 'generic';
    return IMPLICIT_ROLES[tag] ?? 'generic';
  }

  /** Approximation of the accessible-name computation, in priority order. */
  function nameOf(el: Element): string {
    const aria = el.getAttribute('aria-label');
    if (aria) return norm(aria);

    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const text = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' ');
      if (norm(text)) return norm(text);
    }

    if (el.id) {
      const forLabel = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (forLabel?.textContent) return norm(forLabel.textContent);
    }

    const wrapping = el.closest('label');
    if (wrapping?.textContent) return norm(wrapping.textContent);

    const tag = el.tagName.toLowerCase();
    if (tag === 'img') return norm(el.getAttribute('alt'));
    if (tag === 'input') {
      const input = el as HTMLInputElement;
      if (input.type === 'button' || input.type === 'submit' || input.type === 'reset') {
        return norm(input.value);
      }
      return norm(input.placeholder || input.getAttribute('title'));
    }
    // For containers, only use text when it is short enough to be a label.
    const text = norm(el.textContent);
    return text.length <= 80 ? text : '';
  }

  function isVisible(el: Element): boolean {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    const style = window.getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
  }

  /** Shortest selector that still resolves to exactly this element. */
  function uniqueSelector(el: Element): string {
    const testId = el.getAttribute(testIdAttribute);
    if (testId) {
      const sel = `[${testIdAttribute}="${CSS.escape(testId)}"]`;
      if (document.querySelectorAll(sel).length === 1) return sel;
    }
    if (el.id && document.querySelectorAll(`#${CSS.escape(el.id)}`).length === 1) {
      return `#${CSS.escape(el.id)}`;
    }
    for (const attr of ['name', 'data-test', 'data-qa', 'data-cy', 'aria-label']) {
      const v = el.getAttribute(attr);
      if (!v) continue;
      const sel = `${el.tagName.toLowerCase()}[${attr}="${CSS.escape(v)}"]`;
      if (document.querySelectorAll(sel).length === 1) return sel;
    }
    // Fall back to a structural path, capped in depth to stay readable.
    const parts: string[] = [];
    let node: Element | null = el;
    while (node && node.nodeType === 1 && parts.length < 6) {
      let part = node.tagName.toLowerCase();
      if (node.id) {
        parts.unshift(`#${CSS.escape(node.id)}`);
        break;
      }
      const parent: Element | null = node.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((c) => c.tagName === node!.tagName);
        if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      node = parent;
    }
    return parts.join(' > ');
  }

  const SELECTABLE =
    'a[href], button, input, select, textarea, summary, [role], [onclick], ' +
    '[tabindex]:not([tabindex="-1"]), [contenteditable="true"], label, ' +
    'h1, h2, h3, h4, h5, h6, td, th, li, [' +
    testIdAttribute +
    ']';

  const seen = new Set<Element>();
  const out: Array<Record<string, unknown>> = [];

  for (const el of Array.from(document.querySelectorAll(SELECTABLE))) {
    if (seen.has(el)) continue;
    seen.add(el);
    const visible = isVisible(el);
    if (!visible && !includeHidden) continue;

    const tag = el.tagName.toLowerCase();
    const input = el as HTMLInputElement;
    out.push({
      ref: uniqueSelector(el),
      role: roleOf(el),
      name: nameOf(el),
      tag,
      testId: el.getAttribute(testIdAttribute) ?? undefined,
      id: el.id || undefined,
      classes: norm(el.getAttribute('class')) || undefined,
      placeholder: input.placeholder || undefined,
      label: el.getAttribute('aria-label') ?? undefined,
      text: norm(el.textContent).slice(0, 120) || undefined,
      type: tag === 'input' ? input.type : undefined,
      visible,
    });
    if (out.length >= limit) break;
  }

  return {
    url: location.href,
    title: document.title,
    candidates: out,
    // Cheap structural fingerprint: tag skeleton + test ids, not text.
    structure: Array.from(document.querySelectorAll('*'))
      .slice(0, 800)
      .map((e) => e.tagName + (e.getAttribute(testIdAttribute) ?? ''))
      .join(','),
  };
}
/* c8 ignore stop */

/**
 * esbuild-based runners (tsx, which the `aiqa` CLI uses) compile named inner
 * functions with a `__name(fn, "name")` helper for `keepNames`. That helper is
 * defined in the Node module scope, not in the page, so the serialised
 * `collectInPage` throws `ReferenceError: __name is not defined` inside the
 * browser. Playwright's own transpiler does not do this, so the failure only
 * shows up outside the test runner. Shimming it is the smallest fix that keeps
 * the collector readable as ordinary TypeScript.
 */
async function ensureEvalShim(page: Page): Promise<void> {
  await page.evaluate(() => {
    const g = globalThis as unknown as { __name?: (fn: unknown) => unknown };
    g.__name ??= (fn: unknown) => fn;
  });
}

/** Capture the flat candidate list plus a structural signature. */
export async function captureCandidates(
  page: Page,
  opts: CaptureOptions = {},
): Promise<{ candidates: DomCandidate[]; url: string; title: string; signature: string }> {
  await ensureEvalShim(page);
  const raw = await page.evaluate(collectInPage, {
    testIdAttribute: opts.testIdAttribute ?? 'data-testid',
    limit: opts.limit ?? 400,
    includeHidden: opts.includeHidden ?? false,
  });

  return {
    candidates: raw.candidates as unknown as DomCandidate[],
    url: raw.url,
    title: raw.title,
    signature: createHash('sha256').update(raw.structure).digest('hex').slice(0, 16),
  };
}

/**
 * Playwright's aria snapshot, scoped as tightly as possible. Prefer a
 * container scope when one is known — it keeps the prompt small and focused.
 */
export async function captureAria(page: Page, scope?: string): Promise<string> {
  try {
    const root = scope ? page.locator(scope) : page.locator('body');
    return await root.ariaSnapshot({ timeout: 5_000 });
  } catch {
    return '';
  }
}

/** Full snapshot, trimmed to the configured character budget. */
export async function capturePage(
  page: Page,
  opts: CaptureOptions & { maxChars?: number; scope?: string } = {},
): Promise<PageSnapshot> {
  const [flat, aria] = await Promise.all([
    captureCandidates(page, opts),
    captureAria(page, opts.scope),
  ]);

  const maxChars = opts.maxChars ?? 60_000;
  return {
    url: flat.url,
    title: flat.title,
    aria: aria.length > maxChars ? `${aria.slice(0, maxChars)}\n# ...truncated` : aria,
    candidates: flat.candidates,
    signature: flat.signature,
  };
}

/** Compact table rendering of candidates for the model prompt. */
export function renderCandidates(candidates: DomCandidate[], limit = 120): string {
  const rows = candidates.slice(0, limit).map((c) => {
    const bits = [
      `role=${c.role}`,
      c.name ? `name="${c.name}"` : '',
      c.testId ? `testid="${c.testId}"` : '',
      c.id ? `id="${c.id}"` : '',
      c.placeholder ? `placeholder="${c.placeholder}"` : '',
      c.type ? `type=${c.type}` : '',
      c.visible ? '' : 'hidden',
    ].filter(Boolean);
    return `<${c.tag}> ${bits.join(' ')} | css: ${c.ref}`;
  });
  return rows.join('\n');
}
