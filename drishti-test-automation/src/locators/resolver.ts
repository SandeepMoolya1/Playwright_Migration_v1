/**
 * Turns a `LocatorDefinition` into a live Playwright `Locator`.
 *
 * This is the only place in the framework that calls `getByRole`, `locator()`
 * and friends. Keeping it in one function means the healer can synthesise a
 * new definition and get exactly the same resolution semantics for free.
 */
import type { FrameLocator, Locator, Page } from '@playwright/test';
import type { LocatorDefinition, LocatorFilter, LocatorStep } from '../core/types.js';
import { describeSteps } from './schema.js';

/** Anything that exposes the `getBy*` / `locator()` surface. */
export type LocatorRoot = Page | Locator | FrameLocator;

/** `name`/`text` become a RegExp when the definition asks for one. */
function matcher(step: LocatorStep): string | RegExp {
  const value = step.text ?? step.name ?? '';
  return step.regex ? new RegExp(value, step.flags ?? 'i') : value;
}

function options(step: LocatorStep): { exact?: boolean } | undefined {
  // `exact` is meaningless (and rejected) alongside a RegExp matcher.
  if (step.regex || step.exact === undefined) return undefined;
  return { exact: step.exact };
}

/** Apply exactly one step against a root, returning the narrowed locator. */
export function applyStep(root: LocatorRoot, step: LocatorStep): Locator {
  switch (step.strategy) {
    case 'role': {
      if (!step.role) throw new Error('role strategy requires "role"');
      const opts: Parameters<Page['getByRole']>[1] = {};
      if (step.name !== undefined) opts.name = matcher(step);
      if (!step.regex && step.exact !== undefined) opts.exact = step.exact;
      return root.getByRole(step.role, opts);
    }
    case 'testId':
      // getByTestId takes no `exact` option in the same shape; pass the matcher.
      return root.getByTestId(matcher(step));
    case 'label':
      return root.getByLabel(matcher(step), options(step));
    case 'placeholder':
      return root.getByPlaceholder(matcher(step), options(step));
    case 'text':
      return root.getByText(matcher(step), options(step));
    case 'altText':
      return root.getByAltText(matcher(step), options(step));
    case 'title':
      return root.getByTitle(matcher(step), options(step));
    case 'css': {
      if (!step.selector) throw new Error('css strategy requires "css"/"selector"');
      return root.locator(step.selector);
    }
    case 'xpath': {
      if (!step.selector) throw new Error('xpath strategy requires "xpath"/"selector"');
      const s = step.selector.startsWith('xpath=') ? step.selector : `xpath=${step.selector}`;
      return root.locator(s);
    }
    default:
      throw new Error(`Unsupported strategy "${String(step.strategy)}"`);
  }
}

/** Build a locator from a chain of steps. */
export function buildChain(root: LocatorRoot, steps: LocatorStep[]): Locator {
  if (steps.length === 0) throw new Error('locator definition has no steps');
  let current = applyStep(root, steps[0]!);
  for (let i = 1; i < steps.length; i++) current = applyStep(current, steps[i]!);
  return current;
}

function applyFilter(locator: Locator, page: Page, filter: LocatorFilter): Locator {
  const opts: Parameters<Locator['filter']>[0] = {};
  if (filter.hasText !== undefined) opts.hasText = filter.hasText;
  if (filter.hasNotText !== undefined) opts.hasNotText = filter.hasNotText;
  if (filter.visible !== undefined) opts.visible = filter.visible;
  // `has` / `hasNot` must be built from the page root, not from the locator
  // being filtered — Playwright resolves them relative to the outer element.
  if (filter.has) opts.has = buildDefinition(page, filter.has);
  if (filter.hasNot) opts.hasNot = buildDefinition(page, filter.hasNot);
  return locator.filter(opts);
}

function applyIndex(locator: Locator, index: LocatorDefinition['index']): Locator {
  if (index === undefined) return locator;
  if (index === 'first') return locator.first();
  if (index === 'last') return locator.last();
  return locator.nth(index);
}

/**
 * Full resolution: optional frame -> step chain -> filter -> index.
 *
 * `overrideSteps` lets the healer evaluate a candidate chain against the same
 * filter/index/frame rules as the original definition.
 */
export function buildDefinition(
  page: Page,
  definition: LocatorDefinition,
  overrideSteps?: LocatorStep[],
): Locator {
  const root: LocatorRoot = definition.frame ? page.frameLocator(definition.frame) : page;
  let locator = buildChain(root, overrideSteps ?? definition.steps);
  if (definition.filter) locator = applyFilter(locator, page, definition.filter);
  return applyIndex(locator, definition.index);
}

/**
 * All resolution attempts for a definition, in priority order: the primary
 * chain first, then each declared fallback. The healer consumes this list
 * before it spends a token on the model.
 */
export function candidateChains(definition: LocatorDefinition): LocatorStep[][] {
  return [definition.steps, ...(definition.fallbacks ?? [])];
}

/** `login.usernameInput -> getByRole('textbox', { name: 'Username' })` */
export function explain(definition: LocatorDefinition): string {
  const parts = [describeSteps(definition.steps)];
  if (definition.filter) parts.push(`.filter(${JSON.stringify(definition.filter)})`);
  if (definition.index === 'first') parts.push('.first()');
  else if (definition.index === 'last') parts.push('.last()');
  else if (typeof definition.index === 'number') parts.push(`.nth(${definition.index})`);
  if (definition.frame) return `frameLocator('${definition.frame}').${parts.join('')}`;
  return parts.join('');
}
