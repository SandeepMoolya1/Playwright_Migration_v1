/**
 * AI root-cause analysis for failed tests.
 *
 * Runs in the reporter process, after the run, from the artifacts the
 * `diagnostics` fixture attached. It never touches the browser, so it adds no
 * time to the tests themselves and works equally well on a CI artifact bundle
 * downloaded after the fact.
 */
import { getConfig } from '../core/config.js';
import { structured } from './client.js';
import { ANALYSIS_SYSTEM } from './prompts.js';
import { failureAnalysisJsonSchema, failureAnalysisSchema } from './schemas.js';
import type { FailureAnalysis, HealRecord } from '../core/types.js';
import type { ConsoleEntry, NetworkEntry } from '../fixtures/capture.js';

/** Shape of the `ai-diagnostics.json` attachment. */
export interface DiagnosticsPayload {
  testTitle: string;
  testFile: string;
  url: string;
  error: string | null;
  stack: string | null;
  snippet: string | null;
  console: ConsoleEntry[];
  network: NetworkEntry[];
  pageErrors: string[];
  heals: HealRecord[];
  aria: string;
}

export interface AnalysisInput extends Partial<DiagnosticsPayload> {
  testTitle: string;
  testFile: string;
  error: string | null;
  /** Names of the steps that ran, in order, for temporal context. */
  steps?: string[];
  /** Whether this test failed on every retry or only sometimes. */
  flaky?: boolean;
  durationMs?: number;
}

const truncate = (s: string | null | undefined, n: number): string =>
  !s ? '(none)' : s.length > n ? `${s.slice(0, n)}\n...[truncated]` : s;

function buildPrompt(input: AnalysisInput): string {
  const lines: string[] = [
    `## Test`,
    `title: ${input.testTitle}`,
    `file: ${input.testFile}`,
    input.durationMs !== undefined ? `duration: ${input.durationMs}ms` : '',
    input.flaky ? `NOTE: this test passed on retry — it is flaky, not consistently broken.` : '',
    input.url ? `url at failure: ${input.url}` : '',
    '',
    `## Error`,
    '```',
    truncate(input.error, 4000),
    '```',
  ];

  if (input.snippet) {
    lines.push('', `## Code frame`, '```ts', truncate(input.snippet, 2000), '```');
  }

  if (input.stack) {
    lines.push('', `## Stack (top frames)`, '```', input.stack.split('\n').slice(0, 12).join('\n'), '```');
  }

  if (input.steps?.length) {
    lines.push('', `## Steps that ran`, input.steps.map((s, i) => `${i + 1}. ${s}`).join('\n'));
  }

  if (input.heals?.length) {
    lines.push(
      '',
      `## Locators healed during this test`,
      input.heals
        .map(
          (h) =>
            `- ${h.key} (${h.source}, confidence ${h.confidence.toFixed(2)}): ` +
            `was ${h.failedWith}, now ${JSON.stringify(h.healedWith)}` +
            (h.reasoning ? ` — ${h.reasoning}` : ''),
        )
        .join('\n'),
    );
  }

  if (input.pageErrors?.length) {
    lines.push('', `## Uncaught page errors`, input.pageErrors.slice(0, 10).map((e) => `- ${e}`).join('\n'));
  }

  if (input.console?.length) {
    lines.push(
      '',
      `## Console`,
      input.console
        .slice(-25)
        .map((c) => `[${c.type}] ${c.text}`)
        .join('\n')
        .slice(0, 4000),
    );
  }

  if (input.network?.length) {
    lines.push(
      '',
      `## Failed network requests`,
      input.network
        .slice(-25)
        .map((n) => `${n.method} ${n.url} -> ${n.failure ?? n.status}`)
        .join('\n')
        .slice(0, 3000),
    );
  }

  if (input.aria) {
    lines.push('', `## Accessibility snapshot at failure`, '```yaml', truncate(input.aria, 12_000), '```');
  }

  lines.push('', 'Diagnose this failure.');
  return lines.filter((l) => l !== '').join('\n');
}

/** Analyse one failure. Returns `null` when AI is unavailable or declines. */
export async function analyzeFailure(input: AnalysisInput): Promise<FailureAnalysis | null> {
  const cfg = getConfig();
  if (!cfg.analysis.enabled) return null;

  const result = await structured({
    system: ANALYSIS_SYSTEM,
    user: buildPrompt(input),
    schema: failureAnalysisSchema,
    jsonSchema: failureAnalysisJsonSchema,
    purpose: 'analysis',
    effort: 'high',
  });

  if (!result) return null;
  return { testTitle: input.testTitle, file: input.testFile, ...result };
}

/** Render analyses as the Markdown report written to `.ai/report/`. */
export function renderAnalysisReport(analyses: FailureAnalysis[], heals: HealRecord[]): string {
  const lines: string[] = ['# AI test run analysis', ''];

  if (heals.length) {
    lines.push(
      `## Locators healed (${heals.length})`,
      '',
      '| Element | Tier | Confidence | Was | Now | Written back |',
      '| --- | --- | --- | --- | --- | --- |',
      ...heals.map(
        (h) =>
          `| \`${h.key}\` | ${h.source} | ${Math.round(h.confidence * 100)}% | ` +
          `\`${h.failedWith}\` | \`${JSON.stringify(h.healedWith)}\` | ${h.persisted ? 'yes' : 'no'} |`,
      ),
      '',
      heals.some((h) => !h.persisted)
        ? '> Heals marked "no" were applied for this run only. Run with `AI_HEAL_PERSIST=on` to write them into the YAML.'
        : '',
      '',
    );
  }

  if (!analyses.length) {
    lines.push('## Failures', '', 'No failures analysed.');
    return lines.join('\n');
  }

  const byCategory = new Map<string, number>();
  for (const a of analyses) byCategory.set(a.category, (byCategory.get(a.category) ?? 0) + 1);

  lines.push(
    `## Failures (${analyses.length})`,
    '',
    '| Category | Count |',
    '| --- | --- |',
    ...[...byCategory].map(([c, n]) => `| ${c} | ${n} |`),
    '',
  );

  for (const a of analyses) {
    lines.push(
      `### ${a.testTitle}`,
      '',
      `- **Category:** \`${a.category}\` (confidence ${Math.round(a.confidence * 100)}%)`,
      `- **File:** \`${a.file}\``,
      '',
      `**${a.summary}**`,
      '',
      `**Root cause.** ${a.rootCause}`,
      '',
      a.evidence.length ? `**Evidence**\n${a.evidence.map((e) => `- ${e}`).join('\n')}\n` : '',
      `**Suggested fix.** ${a.suggestedFix}`,
      '',
      a.patch ? `\`\`\`diff\n${a.patch}\n\`\`\`\n` : '',
      '---',
      '',
    );
  }

  return lines.filter((l) => l !== undefined).join('\n');
}
