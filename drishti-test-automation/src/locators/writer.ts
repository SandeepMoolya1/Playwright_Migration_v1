/**
 * Writes healed locators back into their YAML source.
 *
 * Uses the `yaml` Document API rather than `stringify(parse(x))` so that
 * comments, key order and blank lines written by engineers survive the
 * round-trip. A heal never destroys the old selector: it is demoted to the
 * front of `fallbacks`, so a heal is always reversible by hand.
 */
import fs from 'node:fs';
import YAML, { isMap, type Document } from 'yaml';
import type { LocatorDefinition, LocatorStep } from '../core/types.js';
import { describeSteps } from './schema.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('locators:write');

/** Drop undefined keys so the emitted YAML stays clean. */
function compactStep(step: LocatorStep): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const put = (k: string, v: unknown) => {
    if (v !== undefined && v !== null && v !== '') out[k] = v;
  };
  switch (step.strategy) {
    case 'role':
      put('role', step.role);
      put('name', step.name);
      break;
    case 'css':
      put('css', step.selector);
      break;
    case 'xpath':
      put('xpath', step.selector);
      break;
    default:
      put(step.strategy, step.text);
      break;
  }
  put('exact', step.exact);
  put('regex', step.regex);
  put('flags', step.flags);
  return out;
}

/** A single-step chain emits as one mapping; a chain emits as a sequence. */
function emitChain(steps: LocatorStep[]): unknown {
  const mapped = steps.map(compactStep);
  return mapped.length === 1 ? mapped[0] : mapped;
}

function toPlainDefinition(def: LocatorDefinition): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (def.description) out.description = def.description;
  const primary = emitChain(def.steps);
  // Keep the terse inline form when there is exactly one step and no chain,
  // so a healed entry reads the same as a hand-written one.
  if (def.steps.length === 1) Object.assign(out, primary as Record<string, unknown>);
  else out.steps = primary;

  if (def.fallbacks?.length) out.fallbacks = def.fallbacks.map(emitChain);
  if (def.filter) out.filter = def.filter;
  if (def.index !== undefined) out.index = def.index;
  if (def.multiple !== undefined) out.multiple = def.multiple;
  if (def.frame) out.frame = def.frame;
  if (def.heal !== undefined) out.heal = def.heal;
  if (def.tags?.length) out.tags = def.tags;
  if (def.healedAt) out.healedAt = def.healedAt;
  if (def.healedFrom) out.healedFrom = def.healedFrom;
  return out;
}

export interface PersistOptions {
  sourcePath: string;
  element: string;
  /** The definition as loaded before healing. */
  previous: LocatorDefinition;
  /** The chain the healer validated against the live page. */
  healedSteps: LocatorStep[];
  /** Short note appended as a YAML comment above the element. */
  note?: string;
}

/**
 * Promote `healedSteps` to primary, demote the previous primary chain into
 * `fallbacks`, and stamp the audit fields. Returns the new definition.
 */
export function persistHeal(opts: PersistOptions): LocatorDefinition {
  const { sourcePath, element, previous, healedSteps } = opts;

  const demoted = [previous.steps, ...(previous.fallbacks ?? [])];
  // Guard against the same chain accumulating on repeated heals.
  const seen = new Set<string>();
  const fallbacks = demoted.filter((chain) => {
    const sig = JSON.stringify(chain);
    if (seen.has(sig) || sig === JSON.stringify(healedSteps)) return false;
    seen.add(sig);
    return true;
  });

  const next: LocatorDefinition = {
    ...previous,
    steps: healedSteps,
    fallbacks: fallbacks.slice(0, 5), // keep history bounded
    healedAt: new Date().toISOString(),
    healedFrom: describeSteps(previous.steps),
  };

  try {
    const doc = YAML.parseDocument(fs.readFileSync(sourcePath, 'utf8')) as Document.Parsed;
    const elements = doc.get('elements');
    if (!isMap(elements)) {
      log.warn(`${sourcePath}: no "elements" mapping — skipping write-back`);
      return next;
    }

    const existingPair = elements.items.find(
      (pair) => String((pair.key as { value?: unknown })?.value ?? pair.key) === element,
    );

    const node = doc.createNode(toPlainDefinition(next));
    if (existingPair) {
      // Preserve any comment the engineer attached to this element.
      const carried = (existingPair.value as { comment?: string; commentBefore?: string } | null);
      if (carried?.commentBefore) {
        (node as { commentBefore?: string }).commentBefore = carried.commentBefore;
      }
      existingPair.value = node;
    } else {
      elements.set(doc.createNode(element), node);
    }

    fs.writeFileSync(sourcePath, doc.toString({ lineWidth: 0, indent: 2 }), 'utf8');
    log.ok(`persisted heal for ${element} -> ${sourcePath}`);
  } catch (err) {
    // A failed write must never fail the test — the heal already worked
    // in memory, and the journal records what should have been written.
    log.warn(`could not persist heal for ${element}: ${(err as Error).message}`);
  }

  return next;
}

/** Render a fresh locator file from scratch (used by `aiqa scan`). */
export function renderLocatorFile(
  meta: {
    name: string;
    description?: string;
    url?: string;
    testIdAttribute?: string;
    persistHeals?: boolean;
  },
  elements: Record<string, LocatorDefinition>,
): string {
  const doc = new YAML.Document({
    meta: Object.fromEntries(Object.entries(meta).filter(([, v]) => v !== undefined)),
    elements: Object.fromEntries(
      Object.entries(elements).map(([k, v]) => [k, toPlainDefinition(v)]),
    ),
  });
  doc.commentBefore =
    ' Generated by `aiqa scan`. Safe to edit by hand.\n' +
    ' `description` drives AI healing — keep it accurate.';
  return doc.toString({ lineWidth: 0, indent: 2 });
}
