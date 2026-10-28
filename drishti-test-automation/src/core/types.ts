/**
 * Shared framework types.
 *
 * The locator repository is the heart of the framework: every element a test
 * touches is declared in a YAML file, never inline in a spec. That gives us a
 * single place to heal, audit and regenerate selectors.
 */

/** Every locator strategy Playwright exposes, plus raw engine selectors. */
export type StrategyName =
  | 'role'
  | 'testId'
  | 'label'
  | 'placeholder'
  | 'text'
  | 'altText'
  | 'title'
  | 'css'
  | 'xpath';

/** ARIA roles accepted by `getByRole`. Kept as a string union for editor hints. */
export type AriaRole =
  | 'alert' | 'alertdialog' | 'application' | 'article' | 'banner' | 'blockquote'
  | 'button' | 'caption' | 'cell' | 'checkbox' | 'code' | 'columnheader'
  | 'combobox' | 'complementary' | 'contentinfo' | 'definition' | 'deletion'
  | 'dialog' | 'directory' | 'document' | 'emphasis' | 'feed' | 'figure'
  | 'form' | 'generic' | 'grid' | 'gridcell' | 'group' | 'heading' | 'img'
  | 'insertion' | 'link' | 'list' | 'listbox' | 'listitem' | 'log' | 'main'
  | 'marquee' | 'math' | 'menu' | 'menubar' | 'menuitem' | 'menuitemcheckbox'
  | 'menuitemradio' | 'meter' | 'navigation' | 'none' | 'note' | 'option'
  | 'paragraph' | 'presentation' | 'progressbar' | 'radio' | 'radiogroup'
  | 'region' | 'row' | 'rowgroup' | 'rowheader' | 'scrollbar' | 'search'
  | 'searchbox' | 'separator' | 'slider' | 'spinbutton' | 'status' | 'strong'
  | 'subscript' | 'superscript' | 'switch' | 'tab' | 'table' | 'tablist'
  | 'tabpanel' | 'term' | 'textbox' | 'time' | 'timer' | 'toolbar' | 'tooltip'
  | 'tree' | 'treegrid' | 'treeitem';

/**
 * One way of finding an element. A `LocatorStep` maps 1:1 onto a single
 * Playwright `getBy*` / `locator()` call; chains are expressed as an array.
 */
export interface LocatorStep {
  strategy: StrategyName;
  /** getByRole */
  role?: AriaRole;
  /** Accessible name for getByRole, or the text for the text-ish strategies. */
  name?: string;
  text?: string;
  /** css / xpath selector body. */
  selector?: string;
  /** Exact match toggle for all getBy* text matching. */
  exact?: boolean;
  /** Treat `name`/`text` as a JS regular expression source, e.g. "^Sign in$". */
  regex?: boolean;
  /** Regex flags when `regex` is true. Defaults to "i". */
  flags?: string;
}

/** Narrowing applied after the base step resolves. Mirrors `locator.filter()`. */
export interface LocatorFilter {
  hasText?: string;
  hasNotText?: string;
  /** Nested locator definition for `has` / `hasNot`. */
  has?: LocatorDefinition;
  hasNot?: LocatorDefinition;
  visible?: boolean;
}

/** Positional selection applied last. */
export type LocatorIndex = number | 'first' | 'last';

/**
 * A complete, resolvable element definition as it appears under
 * `elements:` in a `*.locators.yml` file.
 */
export interface LocatorDefinition {
  /**
   * Human description. This is the single most important field for healing —
   * the AI healer uses it as the intent when the selector stops matching.
   */
  description?: string;
  /** Primary resolution chain. One step is the common case. */
  steps: LocatorStep[];
  /** Ordered alternatives tried (deterministically, no AI) before healing. */
  fallbacks?: LocatorStep[][];
  filter?: LocatorFilter;
  index?: LocatorIndex;
  /**
   * This element is a collection — a list of rows, every cell in a column.
   * Matching many elements is then expected rather than a strict-mode defect,
   * and a healed replacement is allowed to match many too.
   */
  multiple?: boolean;
  /** Resolve inside an iframe first. */
  frame?: string;
  /** Per-element override of the global healing switch. */
  heal?: boolean;
  /** Free-form tags used by `aiqa audit` (e.g. "critical", "flaky"). */
  tags?: string[];
  /** Audit trail appended by the healer. Managed by the framework. */
  healedAt?: string;
  healedFrom?: string;
}

/** Top-level shape of a `*.locators.yml` file. */
export interface LocatorFileMeta {
  name: string;
  description?: string;
  url?: string;
  /** Per-file override of `testIdAttribute`. */
  testIdAttribute?: string;
  /**
   * Set false to heal at runtime but never write the result back to this
   * file. Useful for pages you do not own, for fixtures that must stay
   * deliberately stale, and for any file you want reviewed by hand.
   */
  persistHeals?: boolean;
  /**
   * Name of a precondition in `aiqa.setup.ts`, run by `aiqa check` after
   * navigating and before probing. Use it for elements that only exist once
   * the app is in a particular state (a seeded cart, a logged-in user).
   */
  state?: string;
}

export interface LocatorFile {
  meta: LocatorFileMeta;
  elements: Record<string, LocatorDefinition>;
}

/** Result of one healing attempt, recorded in the journal and the report. */
export interface HealRecord {
  /** `login.usernameInput` */
  key: string;
  file: string;
  element: string;
  description?: string;
  failedWith: string;
  healedWith: LocatorStep[];
  /** 0..1 — the model's own confidence, validated against the live DOM. */
  confidence: number;
  /** Which tier produced the fix. */
  source: 'fallback' | 'heuristic' | 'ai';
  reasoning?: string;
  persisted: boolean;
  /** Why the heal was not written back, when it was not. Drives the summary. */
  notPersistedBecause?: 'opted-out' | 'low-confidence' | 'persist-disabled' | 'fallback';
  url: string;
  testTitle?: string;
  at: string;
  durationMs: number;
}

/** A single candidate element extracted from the page for healing. */
export interface DomCandidate {
  ref: string;
  role: string;
  name: string;
  tag: string;
  testId?: string;
  id?: string;
  classes?: string;
  placeholder?: string;
  label?: string;
  text?: string;
  type?: string;
  visible: boolean;
  /** Deterministic score from the heuristic matcher, 0..1. */
  score?: number;
}

/** AI failure analysis attached to the HTML report on a failing test. */
export interface FailureAnalysis {
  testTitle: string;
  file: string;
  category:
    | 'locator-drift'
    | 'timing'
    | 'app-bug'
    | 'test-bug'
    | 'environment'
    | 'data'
    | 'network'
    | 'unknown';
  confidence: number;
  summary: string;
  rootCause: string;
  evidence: string[];
  suggestedFix: string;
  /** Unified diff the engineer can apply, when the model can produce one. */
  patch?: string;
}
