/**
 * Zod validators paired with the JSON Schemas sent to the API.
 *
 * The API schema constrains decoding; the Zod schema is the runtime contract
 * on our side. They are written together in this file so they cannot drift.
 */
import { z } from 'zod';

const STRATEGIES = [
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

export const stepSchema = z.object({
  strategy: z.enum(STRATEGIES),
  role: z.string().optional(),
  name: z.string().optional(),
  text: z.string().optional(),
  selector: z.string().optional(),
  exact: z.boolean().optional(),
});

const stepJson = {
  type: 'object',
  additionalProperties: false,
  required: ['strategy'],
  properties: {
    strategy: { type: 'string', enum: [...STRATEGIES] },
    role: { type: 'string', description: 'ARIA role, required when strategy is "role"' },
    name: { type: 'string', description: 'Accessible name, used with strategy "role"' },
    text: {
      type: 'string',
      description: 'The value for testId/label/placeholder/text/altText/title strategies',
    },
    selector: { type: 'string', description: 'CSS or XPath body, for strategy css/xpath' },
    exact: { type: 'boolean' },
  },
} as const;

/* ------------------------------------------------------------------ heal */

export const healProposalSchema = z.object({
  proposals: z
    .array(
      z.object({
        steps: z.array(stepSchema).min(1).max(4),
        confidence: z.number().min(0).max(1),
        reasoning: z.string(),
      }),
    )
    .min(1)
    .max(5),
  /** True when the model believes the element is genuinely gone. */
  elementMissing: z.boolean(),
  notes: z.string().optional(),
});

export type HealProposal = z.infer<typeof healProposalSchema>;

export const healProposalJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['proposals', 'elementMissing'],
  properties: {
    proposals: {
      type: 'array',
      minItems: 1,
      maxItems: 5,
      description: 'Candidate locators, most likely first.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['steps', 'confidence', 'reasoning'],
        properties: {
          steps: {
            type: 'array',
            minItems: 1,
            maxItems: 4,
            description: 'Chain of locator steps; each step narrows the previous one.',
            items: stepJson,
          },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          reasoning: { type: 'string', description: 'One or two sentences.' },
        },
      },
    },
    elementMissing: {
      type: 'boolean',
      description: 'True if no element on this page plausibly matches the intent.',
    },
    notes: { type: 'string' },
  },
} as const;

/* ------------------------------------------------------------------ scan */

export const scanResultSchema = z.object({
  page: z.object({
    name: z.string(),
    description: z.string(),
  }),
  elements: z
    .array(
      z.object({
        name: z.string(),
        description: z.string(),
        steps: z.array(stepSchema).min(1).max(3),
        fallbacks: z.array(z.array(stepSchema).min(1).max(3)).max(3).optional(),
        tags: z.array(z.string()).optional(),
      }),
    )
    .max(200),
});

export type ScanResult = z.infer<typeof scanResultSchema>;

export const scanResultJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['page', 'elements'],
  properties: {
    page: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'description'],
      properties: {
        name: {
          type: 'string',
          description: 'camelCase namespace for the locator file, e.g. "checkoutPage".',
        },
        description: { type: 'string' },
      },
    },
    elements: {
      type: 'array',
      maxItems: 200,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'description', 'steps'],
        properties: {
          name: { type: 'string', description: 'camelCase element key, e.g. "submitButton".' },
          description: {
            type: 'string',
            description: 'What the element is and does. Drives future AI healing.',
          },
          steps: { type: 'array', minItems: 1, maxItems: 3, items: stepJson },
          fallbacks: {
            type: 'array',
            maxItems: 3,
            items: { type: 'array', minItems: 1, maxItems: 3, items: stepJson },
          },
          tags: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
} as const;

/* -------------------------------------------------------------- analysis */

export const failureAnalysisSchema = z.object({
  category: z.enum([
    'locator-drift',
    'timing',
    'app-bug',
    'test-bug',
    'environment',
    'data',
    'network',
    'unknown',
  ]),
  confidence: z.number().min(0).max(1),
  summary: z.string(),
  rootCause: z.string(),
  evidence: z.array(z.string()).max(8),
  suggestedFix: z.string(),
  patch: z.string().optional(),
});

export type FailureAnalysisResult = z.infer<typeof failureAnalysisSchema>;

export const failureAnalysisJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['category', 'confidence', 'summary', 'rootCause', 'evidence', 'suggestedFix'],
  properties: {
    category: {
      type: 'string',
      enum: [
        'locator-drift',
        'timing',
        'app-bug',
        'test-bug',
        'environment',
        'data',
        'network',
        'unknown',
      ],
      description:
        'app-bug means the application is wrong; test-bug means the test is wrong. Choose deliberately — this drives triage.',
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    summary: { type: 'string', description: 'One sentence a QA lead can read in a standup.' },
    rootCause: { type: 'string', description: 'Why it failed, grounded in the evidence given.' },
    evidence: {
      type: 'array',
      maxItems: 8,
      items: { type: 'string' },
      description: 'Direct quotes from the error, console or network data provided.',
    },
    suggestedFix: { type: 'string' },
    patch: { type: 'string', description: 'Unified diff, only when you are confident.' },
  },
} as const;

/* --------------------------------------------------------------- codegen */

export const generatedTestSchema = z.object({
  fileName: z.string(),
  locatorFile: z
    .object({
      name: z.string(),
      yaml: z.string(),
    })
    .optional(),
  pageObject: z.object({ fileName: z.string(), code: z.string() }).optional(),
  spec: z.string(),
  notes: z.string().optional(),
});

export type GeneratedTest = z.infer<typeof generatedTestSchema>;

export const generatedTestJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['fileName', 'spec'],
  properties: {
    fileName: { type: 'string', description: 'e.g. "checkout.spec.ts" — no directories.' },
    locatorFile: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'yaml'],
      properties: {
        name: { type: 'string', description: 'Namespace, e.g. "checkout".' },
        yaml: { type: 'string', description: 'Full contents of a *.locators.yml file.' },
      },
    },
    pageObject: {
      type: 'object',
      additionalProperties: false,
      required: ['fileName', 'code'],
      properties: {
        fileName: { type: 'string' },
        code: { type: 'string' },
      },
    },
    spec: { type: 'string', description: 'Full TypeScript spec file contents.' },
    notes: { type: 'string' },
  },
} as const;
