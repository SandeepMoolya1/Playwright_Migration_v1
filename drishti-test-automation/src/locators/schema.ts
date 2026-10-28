/**
 * Parsing and normalisation for `*.locators.yml`.
 *
 * The YAML is written by testers, so the schema accepts three levels of
 * verbosity and normalises all of them into one `LocatorDefinition`:
 *
 *   usernameInput: "#username"                  # shorthand string
 *   submitButton:  { role: button, name: Log in } # inferred strategy
 *   cartRow:                                     # fully explicit
 *     description: Row in the cart table
 *     steps:
 *       - { strategy: role, role: table, name: Cart }
 *       - { strategy: role, role: row }
 *     filter: { hasText: "Widget" }
 *     index: first
 */
import { z } from 'zod';
import type {
  LocatorDefinition,
  LocatorFile,
  LocatorFilter,
  LocatorStep,
  StrategyName,
} from '../core/types.js';

/** Keys that, when present on a bare object, imply a strategy. */
const INFERRED_KEYS = [
  'role',
  'testId',
  'label',
  'placeholder',
  'text',
  'altText',
  'title',
  'css',
  'xpath',
] as const;

const rawStepObject = z
  .object({
    strategy: z.string().optional(),
    role: z.string().optional(),
    name: z.string().optional(),
    text: z.string().optional(),
    testId: z.string().optional(),
    label: z.string().optional(),
    placeholder: z.string().optional(),
    altText: z.string().optional(),
    title: z.string().optional(),
    css: z.string().optional(),
    xpath: z.string().optional(),
    selector: z.string().optional(),
    exact: z.boolean().optional(),
    regex: z.boolean().optional(),
    flags: z.string().optional(),
  })
  .passthrough();

const rawStep = z.union([z.string(), rawStepObject]);

const rawFilter = z.object({
  hasText: z.string().optional(),
  hasNotText: z.string().optional(),
  has: z.unknown().optional(),
  hasNot: z.unknown().optional(),
  visible: z.boolean().optional(),
});

const rawDefinition = z.union([
  z.string(),
  z
    .object({
      description: z.string().optional(),
      steps: z.array(rawStep).optional(),
      fallbacks: z.array(z.unknown()).optional(),
      filter: rawFilter.optional(),
      index: z.union([z.number().int(), z.literal('first'), z.literal('last')]).optional(),
      multiple: z.boolean().optional(),
      frame: z.string().optional(),
      heal: z.boolean().optional(),
      tags: z.array(z.string()).optional(),
      healedAt: z.string().optional(),
      healedFrom: z.string().optional(),
    })
    .passthrough(),
]);

const rawFile = z.object({
  meta: z
    .object({
      name: z.string().optional(),
      description: z.string().optional(),
      url: z.string().optional(),
      testIdAttribute: z.string().optional(),
      persistHeals: z.boolean().optional(),
      state: z.string().optional(),
    })
    .optional(),
  elements: z.record(rawDefinition),
});

export class LocatorSchemaError extends Error {
  constructor(file: string, key: string, detail: string) {
    super(`${file} -> elements.${key}: ${detail}`);
    this.name = 'LocatorSchemaError';
  }
}

/**
 * A bare string is a selector. We infer the engine the same way Playwright's
 * `page.locator()` does, plus a `text=` convenience prefix.
 */
function stepFromString(raw: string): LocatorStep {
  const s = raw.trim();
  if (s.startsWith('xpath=')) return { strategy: 'xpath', selector: s.slice(6) };
  if (s.startsWith('css=')) return { strategy: 'css', selector: s.slice(4) };
  if (s.startsWith('text=')) return { strategy: 'text', text: s.slice(5) };
  if (s.startsWith('//') || s.startsWith('..')) return { strategy: 'xpath', selector: s };
  return { strategy: 'css', selector: s };
}

function stepFromObject(obj: Record<string, unknown>, ctx: () => [string, string]): LocatorStep {
  const explicit = obj.strategy as StrategyName | undefined;
  const pick = (k: string) => (typeof obj[k] === 'string' ? (obj[k] as string) : undefined);

  const common = {
    exact: typeof obj.exact === 'boolean' ? obj.exact : undefined,
    regex: typeof obj.regex === 'boolean' ? obj.regex : undefined,
    flags: pick('flags'),
  };

  const strategy: StrategyName | undefined =
    explicit ?? (INFERRED_KEYS.find((k) => typeof obj[k] === 'string') as StrategyName | undefined);

  if (!strategy) {
    const [file, key] = ctx();
    throw new LocatorSchemaError(
      file,
      key,
      `cannot infer a strategy. Provide one of ${INFERRED_KEYS.join(', ')} or an explicit "strategy".`,
    );
  }

  switch (strategy) {
    case 'role': {
      const role = pick('role');
      if (!role) throw new LocatorSchemaError(...ctx(), 'strategy "role" requires a "role" value.');
      return { strategy, role: role as LocatorStep['role'], name: pick('name'), ...common };
    }
    case 'testId':
      return { strategy, text: pick('testId') ?? pick('text') ?? pick('name'), ...common };
    case 'label':
      return { strategy, text: pick('label') ?? pick('text') ?? pick('name'), ...common };
    case 'placeholder':
      return { strategy, text: pick('placeholder') ?? pick('text'), ...common };
    case 'altText':
      return { strategy, text: pick('altText') ?? pick('text'), ...common };
    case 'title':
      return { strategy, text: pick('title') ?? pick('text'), ...common };
    case 'text':
      return { strategy, text: pick('text') ?? pick('name'), ...common };
    case 'css':
      return { strategy, selector: pick('css') ?? pick('selector'), ...common };
    case 'xpath':
      return { strategy, selector: pick('xpath') ?? pick('selector'), ...common };
    default: {
      const [file, key] = ctx();
      throw new LocatorSchemaError(file, key, `unknown strategy "${String(strategy)}".`);
    }
  }
}

function toStep(raw: unknown, ctx: () => [string, string]): LocatorStep {
  if (typeof raw === 'string') return stepFromString(raw);
  if (raw && typeof raw === 'object') return stepFromObject(raw as Record<string, unknown>, ctx);
  const [file, key] = ctx();
  throw new LocatorSchemaError(file, key, 'a step must be a string or a mapping.');
}

/** A fallback entry may be a single step or a chain of steps. */
function toChain(raw: unknown, ctx: () => [string, string]): LocatorStep[] {
  if (Array.isArray(raw)) return raw.map((s) => toStep(s, ctx));
  return [toStep(raw, ctx)];
}

function toFilter(raw: unknown, ctx: () => [string, string]): LocatorFilter | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const parsed = rawFilter.parse(raw);
  const out: LocatorFilter = {};
  if (parsed.hasText !== undefined) out.hasText = parsed.hasText;
  if (parsed.hasNotText !== undefined) out.hasNotText = parsed.hasNotText;
  if (parsed.visible !== undefined) out.visible = parsed.visible;
  if (parsed.has !== undefined) out.has = normalizeDefinition(parsed.has, ctx);
  if (parsed.hasNot !== undefined) out.hasNot = normalizeDefinition(parsed.hasNot, ctx);
  return Object.keys(out).length ? out : undefined;
}

/** Turn any accepted YAML shape into the canonical `LocatorDefinition`. */
export function normalizeDefinition(raw: unknown, ctx: () => [string, string]): LocatorDefinition {
  const parsed = rawDefinition.parse(raw);

  if (typeof parsed === 'string') return { steps: [stepFromString(parsed)] };

  const obj = parsed as Record<string, unknown>;
  const steps: LocatorStep[] = Array.isArray(obj.steps)
    ? obj.steps.map((s) => toStep(s, ctx))
    : [stepFromObject(obj, ctx)];

  const def: LocatorDefinition = { steps };
  if (typeof obj.description === 'string') def.description = obj.description;
  if (Array.isArray(obj.fallbacks)) def.fallbacks = obj.fallbacks.map((f) => toChain(f, ctx));
  const filter = toFilter(obj.filter, ctx);
  if (filter) def.filter = filter;
  if (obj.index !== undefined) def.index = obj.index as LocatorDefinition['index'];
  if (typeof obj.multiple === 'boolean') def.multiple = obj.multiple;
  if (typeof obj.frame === 'string') def.frame = obj.frame;
  if (typeof obj.heal === 'boolean') def.heal = obj.heal;
  if (Array.isArray(obj.tags)) def.tags = obj.tags as string[];
  if (typeof obj.healedAt === 'string') def.healedAt = obj.healedAt;
  if (typeof obj.healedFrom === 'string') def.healedFrom = obj.healedFrom;
  return def;
}

/** Parse and normalise a whole file. `fileName` is used in error messages. */
export function parseLocatorFile(data: unknown, fileName: string): LocatorFile {
  const parsed = rawFile.parse(data);
  const elements: Record<string, LocatorDefinition> = {};
  for (const [key, value] of Object.entries(parsed.elements)) {
    elements[key] = normalizeDefinition(value, () => [fileName, key]);
  }
  return {
    meta: {
      name: parsed.meta?.name ?? fileName.replace(/\.locators\.ya?ml$/, ''),
      description: parsed.meta?.description,
      url: parsed.meta?.url,
      testIdAttribute: parsed.meta?.testIdAttribute,
      persistHeals: parsed.meta?.persistHeals,
      state: parsed.meta?.state,
    },
    elements,
  };
}

/** Compact, human-readable rendering of a chain — used in logs and errors. */
export function describeSteps(steps: LocatorStep[]): string {
  return steps.map(describeStep).join(' >> ');
}

export function describeStep(step: LocatorStep): string {
  switch (step.strategy) {
    case 'role':
      return `getByRole('${step.role}'${step.name ? `, { name: '${step.name}' }` : ''})`;
    case 'css':
      return `locator('${step.selector}')`;
    case 'xpath':
      return `locator('xpath=${step.selector}')`;
    default: {
      const method = `getBy${step.strategy.charAt(0).toUpperCase()}${step.strategy.slice(1)}`;
      return `${method}('${step.text ?? ''}')`;
    }
  }
}
