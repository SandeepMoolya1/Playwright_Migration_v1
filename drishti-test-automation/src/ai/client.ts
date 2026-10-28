/**
 * Thin, opinionated wrapper around the Anthropic SDK.
 *
 * Everything the framework asks the model for is a structured answer, so the
 * one method that matters is `structured()`: it constrains the response with
 * `output_config.format`, validates the parsed JSON against a Zod schema, and
 * returns typed data. Callers never see raw text.
 *
 * Design notes:
 *  - The system prompt is cached (`cache_control`) because the same rubric is
 *    resent on every heal in a run. Volatile content (the DOM) always goes in
 *    the user turn, after the cache breakpoint.
 *  - Failures are non-fatal by contract: healing degrades to the deterministic
 *    tiers, so `structured()` returns `null` rather than throwing on an API
 *    error, and logs why.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { z } from 'zod';
import { getConfig, hasCredentials } from '../core/config.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('ai');

let client: Anthropic | undefined;

/** Lazily construct the client so importing the framework never needs a key. */
export function getClient(): Anthropic | undefined {
  if (!hasCredentials()) return undefined;
  // Zero-arg constructor: resolves ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN,
  // or an `ant auth login` profile, in that order.
  client ??= new Anthropic({ maxRetries: 2, timeout: 120_000 });
  return client;
}

export interface StructuredRequest<T extends z.ZodTypeAny> {
  system: string;
  user: string | Anthropic.MessageParam['content'];
  schema: T;
  /** JSON Schema matching `schema`, handed to the API for constrained decoding. */
  jsonSchema: Record<string, unknown>;
  model?: string;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  maxTokens?: number;
  /** Label used in logs and the token ledger. */
  purpose: string;
}

/** Running token/cost ledger so `aiqa` can report what a run actually spent. */
export const usageLedger = {
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  byPurpose: {} as Record<string, number>,
  reset() {
    this.calls = 0;
    this.inputTokens = 0;
    this.outputTokens = 0;
    this.cacheReadTokens = 0;
    this.cacheWriteTokens = 0;
    this.byPurpose = {};
  },
};

function record(purpose: string, usage: Anthropic.Usage | undefined): void {
  usageLedger.calls += 1;
  usageLedger.byPurpose[purpose] = (usageLedger.byPurpose[purpose] ?? 0) + 1;
  if (!usage) return;
  usageLedger.inputTokens += usage.input_tokens ?? 0;
  usageLedger.outputTokens += usage.output_tokens ?? 0;
  usageLedger.cacheReadTokens += usage.cache_read_input_tokens ?? 0;
  usageLedger.cacheWriteTokens += usage.cache_creation_input_tokens ?? 0;
}

/**
 * Ask for a schema-constrained answer. Returns `null` when the model is
 * unavailable, refuses, or returns something the schema rejects — the caller
 * is always expected to have a non-AI path.
 */
export async function structured<T extends z.ZodTypeAny>(
  req: StructuredRequest<T>,
): Promise<z.infer<T> | null> {
  const api = getClient();
  if (!api) {
    log.debug(`skipping ${req.purpose}: no Anthropic credentials available`);
    return null;
  }

  const cfg = getConfig();
  const model = req.model ?? cfg.ai.model;

  try {
    const response = await api.messages.create({
      model,
      max_tokens: req.maxTokens ?? cfg.ai.maxTokens,
      thinking: { type: 'adaptive' },
      output_config: {
        effort: req.effort ?? cfg.ai.effort,
        format: { type: 'json_schema', schema: req.jsonSchema },
      },
      system: [
        { type: 'text', text: req.system, cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content: req.user as string }],
    });

    record(req.purpose, response.usage);

    if (response.stop_reason === 'refusal') {
      log.warn(`${req.purpose}: model declined (${response.stop_details?.category ?? 'unknown'})`);
      return null;
    }
    if (response.stop_reason === 'max_tokens') {
      log.warn(`${req.purpose}: response hit max_tokens — raise ai.maxTokens`);
      return null;
    }

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');

    if (!text.trim()) {
      log.warn(`${req.purpose}: empty response`);
      return null;
    }

    const parsed = req.schema.safeParse(JSON.parse(text));
    if (!parsed.success) {
      log.warn(`${req.purpose}: response failed schema validation`, parsed.error.issues.slice(0, 3));
      return null;
    }
    return parsed.data;
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      log.error(`${req.purpose}: invalid Anthropic credentials — AI features disabled`);
    } else if (err instanceof Anthropic.RateLimitError) {
      log.warn(`${req.purpose}: rate limited`);
    } else if (err instanceof Anthropic.APIError) {
      log.warn(`${req.purpose}: API error ${err.status} — ${err.message}`);
    } else if (err instanceof SyntaxError) {
      log.warn(`${req.purpose}: model returned invalid JSON`);
    } else {
      log.warn(`${req.purpose}: ${(err as Error).message}`);
    }
    return null;
  }
}

/** Plain-text generation, used for the Markdown failure report. */
export async function text(req: {
  system: string;
  user: string;
  purpose: string;
  model?: string;
  maxTokens?: number;
}): Promise<string | null> {
  const api = getClient();
  if (!api) return null;
  const cfg = getConfig();
  try {
    const stream = api.messages.stream({
      model: req.model ?? cfg.ai.model,
      max_tokens: req.maxTokens ?? cfg.ai.maxTokens,
      thinking: { type: 'adaptive' },
      output_config: { effort: cfg.ai.effort },
      system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: req.user }],
    });
    const message = await stream.finalMessage();
    record(req.purpose, message.usage);
    if (message.stop_reason === 'refusal') return null;
    return message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
  } catch (err) {
    log.warn(`${req.purpose}: ${(err as Error).message}`);
    return null;
  }
}

/** Human-readable summary of what the run spent. */
export function usageSummary(): string {
  const u = usageLedger;
  if (u.calls === 0) return 'no AI calls';
  const parts = [
    `${u.calls} call(s)`,
    `${u.inputTokens} in`,
    `${u.outputTokens} out`,
  ];
  if (u.cacheReadTokens) parts.push(`${u.cacheReadTokens} cached`);
  return parts.join(', ');
}
