/**
 * `aiqa gen` — natural-language test generation.
 *
 * Two phases, deliberately separated:
 *
 *   1. EXPLORE. The model drives a real browser through a bounded tool loop
 *      (navigate / click / fill / press / snapshot). It discovers the actual
 *      flow instead of guessing at it, and every element it touches is
 *      recorded from the live DOM.
 *   2. WRITE. A single structured call turns the recorded journey into a spec
 *      plus the locator YAML it depends on, following this framework's
 *      conventions.
 *
 * Splitting them matters: exploration is where hallucinated selectors would
 * be introduced, and it is exactly the phase where we can verify every action
 * against a real page before it reaches the generated file.
 */
import Anthropic from '@anthropic-ai/sdk';
import { chromium, type Browser, type Page } from '@playwright/test';
import { getConfig } from '../core/config.js';
import { createLogger } from '../core/logger.js';
import { capturePage, renderCandidates } from '../dom/snapshot.js';
import { getClient, structured } from './client.js';
import { CODEGEN_SYSTEM } from './prompts.js';
import { generatedTestJsonSchema, generatedTestSchema, type GeneratedTest } from './schemas.js';

const log = createLogger('gen');

export interface GenerateOptions {
  goal: string;
  url: string;
  /** Hard cap on browser actions during exploration. */
  maxSteps?: number;
  headed?: boolean;
  storageState?: string;
  /** Namespace hint for the locator file. */
  name?: string;
}

/** One verified action the explorer performed. */
interface JourneyStep {
  action: string;
  target?: string;
  value?: string;
  /** The element as it actually existed, for accurate locator generation. */
  element?: { role: string; name: string; testId?: string; tag: string; css: string };
  url: string;
  ok: boolean;
  note?: string;
}

const EXPLORE_SYSTEM = `
You are exploring a web application to learn how a user journey actually
works, so that a Playwright test can be written for it afterwards.

Drive the page with the tools provided. Work in small, verified steps:
snapshot, decide, act, snapshot again. Never assume a selector — every
selector you pass must come from the "css:" field of a candidate in the most
recent snapshot.

Guidance:
- Call browser_snapshot first, before doing anything else.
- Prefer the smallest number of actions that genuinely completes the goal.
- If an action does not do what you expected, snapshot and adapt rather than
  repeating it.
- Do not navigate away from the application under test, submit payment, or
  perform destructive actions (delete, cancel a real order) unless the goal
  explicitly asks for it.
- When the goal is achieved — or you are confident it cannot be, on this
  application — call finish with an honest summary. A short accurate journey
  is much more useful than a long speculative one.
`.trim();

const EXPLORE_TOOLS: Anthropic.Tool[] = [
  {
    name: 'browser_snapshot',
    description:
      'Capture the current page: URL, title, accessibility tree, and the list of candidate elements with unique CSS selectors. Call this before acting and after any action that changes the page.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'browser_navigate',
    description: 'Navigate to a URL or path.',
    input_schema: {
      type: 'object',
      properties: { url: { type: 'string' } },
      required: ['url'],
      additionalProperties: false,
    },
  },
  {
    name: 'browser_click',
    description: 'Click an element. `css` must be copied from a snapshot candidate.',
    input_schema: {
      type: 'object',
      properties: {
        css: { type: 'string' },
        why: { type: 'string', description: 'What you expect this to do.' },
      },
      required: ['css'],
      additionalProperties: false,
    },
  },
  {
    name: 'browser_fill',
    description: 'Fill a text input. `css` must be copied from a snapshot candidate.',
    input_schema: {
      type: 'object',
      properties: { css: { type: 'string' }, value: { type: 'string' } },
      required: ['css', 'value'],
      additionalProperties: false,
    },
  },
  {
    name: 'browser_press',
    description: 'Press a key, e.g. "Enter" or "Escape".',
    input_schema: {
      type: 'object',
      properties: { key: { type: 'string' } },
      required: ['key'],
      additionalProperties: false,
    },
  },
  {
    name: 'finish',
    description: 'End exploration. Call when the goal is achieved or provably unreachable.',
    input_schema: {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        achieved: { type: 'boolean' },
        assertions: {
          type: 'array',
          items: { type: 'string' },
          description: 'Observable facts that prove the journey succeeded.',
        },
      },
      required: ['summary', 'achieved'],
      additionalProperties: false,
    },
  },
];

interface ExploreResult {
  journey: JourneyStep[];
  summary: string;
  achieved: boolean;
  assertions: string[];
  /** Snapshot of the final page — the assertions target it. */
  finalAria: string;
  finalCandidates: string;
  visitedUrls: string[];
}

/** Phase 1: the bounded tool loop. */
async function explore(page: Page, opts: GenerateOptions): Promise<ExploreResult> {
  const api = getClient();
  const cfg = getConfig();
  const maxSteps = opts.maxSteps ?? 18;

  const journey: JourneyStep[] = [];
  const visitedUrls: string[] = [];
  let finalAria = '';
  let finalCandidates = '';

  if (!api) {
    log.warn('no Anthropic credentials — skipping exploration, generating from the landing page');
    const snap = await capturePage(page, { testIdAttribute: cfg.testIdAttribute });
    return {
      journey,
      summary: 'Exploration skipped (no credentials).',
      achieved: false,
      assertions: [],
      finalAria: snap.aria,
      finalCandidates: renderCandidates(snap.candidates),
      visitedUrls: [page.url()],
    };
  }

  const snapshot = async (): Promise<string> => {
    const snap = await capturePage(page, {
      testIdAttribute: cfg.testIdAttribute,
      maxChars: 25_000,
    });
    finalAria = snap.aria;
    finalCandidates = renderCandidates(snap.candidates, 120);
    if (!visitedUrls.includes(snap.url)) visitedUrls.push(snap.url);
    return [
      `url: ${snap.url}`,
      `title: ${snap.title}`,
      '',
      '## Accessibility tree',
      snap.aria || '(unavailable)',
      '',
      '## Candidates',
      finalCandidates,
    ].join('\n');
  };

  /** Look up the semantic identity of a CSS target, for the write phase. */
  const describeTarget = async (css: string): Promise<JourneyStep['element']> => {
    try {
      const snap = await capturePage(page, { testIdAttribute: cfg.testIdAttribute, limit: 400 });
      const hit = snap.candidates.find((c) => c.ref === css);
      if (!hit) return undefined;
      return {
        role: hit.role,
        name: hit.name,
        testId: hit.testId,
        tag: hit.tag,
        css: hit.ref,
      };
    } catch {
      return undefined;
    }
  };

  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: `Goal: ${opts.goal}\n\nStarting URL: ${opts.url}\n\nExplore and report back.`,
    },
  ];

  let result: ExploreResult | undefined;

  for (let turn = 0; turn < maxSteps && !result; turn++) {
    let response: Anthropic.Message;
    try {
      response = await api.messages.create({
        model: cfg.ai.model,
        max_tokens: cfg.ai.maxTokens,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'high' },
        system: [{ type: 'text', text: EXPLORE_SYSTEM, cache_control: { type: 'ephemeral' } }],
        tools: EXPLORE_TOOLS,
        messages,
      });
    } catch (err) {
      log.warn(`exploration stopped: ${(err as Error).message}`);
      break;
    }

    if (response.stop_reason === 'refusal') {
      log.warn('model declined to continue exploring');
      break;
    }

    messages.push({ role: 'assistant', content: response.content });

    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    );
    if (!toolUses.length) break;

    // Parallel tool calls must all come back in ONE user message.
    const results: Anthropic.ToolResultBlockParam[] = [];

    for (const call of toolUses) {
      // Tool inputs are JSON — never string-match the serialised form.
      const input = call.input as Record<string, unknown>;
      try {
        switch (call.name) {
          case 'browser_snapshot': {
            results.push({ type: 'tool_result', tool_use_id: call.id, content: await snapshot() });
            break;
          }
          case 'browser_navigate': {
            const url = String(input.url);
            await page.goto(url, { waitUntil: 'domcontentloaded' });
            journey.push({ action: 'goto', target: url, url: page.url(), ok: true });
            results.push({ type: 'tool_result', tool_use_id: call.id, content: await snapshot() });
            break;
          }
          case 'browser_click': {
            const css = String(input.css);
            const element = await describeTarget(css);
            await page.locator(css).first().click({ timeout: 10_000 });
            await page.waitForLoadState('domcontentloaded').catch(() => undefined);
            journey.push({
              action: 'click',
              target: css,
              element,
              url: page.url(),
              ok: true,
              note: input.why ? String(input.why) : undefined,
            });
            results.push({ type: 'tool_result', tool_use_id: call.id, content: await snapshot() });
            break;
          }
          case 'browser_fill': {
            const css = String(input.css);
            const value = String(input.value);
            const element = await describeTarget(css);
            await page.locator(css).first().fill(value, { timeout: 10_000 });
            journey.push({ action: 'fill', target: css, value, element, url: page.url(), ok: true });
            results.push({ type: 'tool_result', tool_use_id: call.id, content: 'filled' });
            break;
          }
          case 'browser_press': {
            const key = String(input.key);
            await page.keyboard.press(key);
            await page.waitForLoadState('domcontentloaded').catch(() => undefined);
            journey.push({ action: 'press', value: key, url: page.url(), ok: true });
            results.push({ type: 'tool_result', tool_use_id: call.id, content: await snapshot() });
            break;
          }
          case 'finish': {
            result = {
              journey,
              summary: String(input.summary ?? ''),
              achieved: Boolean(input.achieved),
              assertions: Array.isArray(input.assertions) ? (input.assertions as string[]) : [],
              finalAria,
              finalCandidates,
              visitedUrls,
            };
            results.push({ type: 'tool_result', tool_use_id: call.id, content: 'acknowledged' });
            break;
          }
          default:
            results.push({
              type: 'tool_result',
              tool_use_id: call.id,
              content: `unknown tool ${call.name}`,
              is_error: true,
            });
        }
      } catch (err) {
        const message = (err as Error).message.split('\n')[0] ?? 'action failed';
        journey.push({
          action: call.name,
          target: typeof input.css === 'string' ? input.css : undefined,
          url: page.url(),
          ok: false,
          note: message,
        });
        // Failed actions are returned as errors, not dropped — the model needs
        // to see them to adapt.
        results.push({
          type: 'tool_result',
          tool_use_id: call.id,
          content: `Action failed: ${message}`,
          is_error: true,
        });
      }
    }

    messages.push({ role: 'user', content: results });
    log.debug(`exploration turn ${turn + 1}: ${toolUses.map((t) => t.name).join(', ')}`);
  }

  if (!result) {
    log.warn(`exploration ended after ${maxSteps} step(s) without an explicit finish`);
    if (!finalAria) {
      const snap = await capturePage(page, { testIdAttribute: cfg.testIdAttribute });
      finalAria = snap.aria;
      finalCandidates = renderCandidates(snap.candidates);
    }
    result = {
      journey,
      summary: 'Exploration ran out of steps.',
      achieved: false,
      assertions: [],
      finalAria,
      finalCandidates,
      visitedUrls,
    };
  }

  log.ok(`explored ${result.journey.length} action(s); goal ${result.achieved ? 'achieved' : 'not achieved'}`);
  return result;
}

/** Phase 2: write the spec and locator YAML from the verified journey. */
async function write(opts: GenerateOptions, exploration: ExploreResult): Promise<GeneratedTest | null> {
  const journeyText = exploration.journey
    .map((s, i) => {
      const el = s.element
        ? ` [role=${s.element.role} name="${s.element.name}"` +
          `${s.element.testId ? ` testid="${s.element.testId}"` : ''} css=${s.element.css}]`
        : '';
      return `${i + 1}. ${s.action}${s.target ? ` ${s.target}` : ''}` +
        `${s.value ? ` = "${s.value}"` : ''}${el}` +
        `${s.ok ? '' : `  (FAILED: ${s.note})`}${s.ok && s.note ? `  // ${s.note}` : ''}`;
    })
    .join('\n');

  const user = [
    `## Goal`,
    opts.goal,
    '',
    `## Starting URL`,
    opts.url,
    '',
    `## Verified journey (every element below was observed on the live page)`,
    journeyText || '(no actions recorded — generate from the page structure below)',
    '',
    `## Exploration summary`,
    exploration.summary,
    `Goal achieved during exploration: ${exploration.achieved}`,
    exploration.assertions.length
      ? `Observable facts to assert:\n${exploration.assertions.map((a) => `- ${a}`).join('\n')}`
      : '',
    '',
    `## URLs visited`,
    exploration.visitedUrls.join('\n'),
    '',
    `## Final page accessibility tree`,
    '```yaml',
    exploration.finalAria.slice(0, 20_000),
    '```',
    '',
    `## Final page candidates`,
    '```',
    exploration.finalCandidates.slice(0, 12_000),
    '```',
    '',
    opts.name ? `Use "${opts.name}" as the locator namespace.` : '',
    'Write the spec and the locator YAML.',
  ]
    .filter((l) => l !== '')
    .join('\n');

  return structured({
    system: CODEGEN_SYSTEM,
    user,
    schema: generatedTestSchema,
    jsonSchema: generatedTestJsonSchema,
    purpose: 'codegen',
    effort: 'high',
    maxTokens: 16_000,
  });
}

/** Full generation run: explore a live app, then write the test. */
export async function generateTest(opts: GenerateOptions): Promise<GeneratedTest | null> {
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ headless: !opts.headed });
    const context = await browser.newContext(
      opts.storageState ? { storageState: opts.storageState } : {},
    );
    const page = await context.newPage();
    await page.goto(opts.url, { waitUntil: 'domcontentloaded' });

    log.info(`exploring: ${opts.goal}`);
    const exploration = await explore(page, opts);

    log.info('writing spec...');
    return await write(opts, exploration);
  } finally {
    await browser?.close();
  }
}
