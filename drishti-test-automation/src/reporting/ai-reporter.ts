/**
 * Custom Playwright reporter.
 *
 * Two jobs:
 *   1. Make healing visible. A run that healed is not a clean run, and the
 *      terminal summary says so explicitly, with what to do about it.
 *   2. Explain failures. After the run it feeds each failure's diagnostics
 *      bundle to the analyser and writes `.ai/report/analysis.md`.
 *
 * Analysis happens here, not in the test, so it costs no test wall-clock and
 * can be re-run offline against a CI artifact bundle (`aiqa explain`).
 */
import fs from 'node:fs';
import path from 'node:path';
import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from '@playwright/test/reporter';
import { getConfig } from '../core/config.js';
import { analyzeFailure, renderAnalysisReport, type DiagnosticsPayload } from '../ai/analyzer.js';
import { usageSummary } from '../ai/client.js';
import type { FailureAnalysis, HealRecord } from '../core/types.js';

interface PendingFailure {
  test: TestCase;
  result: TestResult;
  diagnostics?: DiagnosticsPayload;
}

export interface AiReporterOptions {
  /** Write the Markdown report. Default true. */
  writeReport?: boolean;
  /** Run AI analysis. Defaults to the framework config. */
  analyze?: boolean;
  /** Output directory for the report. Default `.ai/report`. */
  outputDir?: string;
}

export default class AiReporter implements Reporter {
  private readonly failures: PendingFailure[] = [];
  private readonly heals: HealRecord[] = [];
  private startedAt = 0;
  private total = 0;

  constructor(private readonly options: AiReporterOptions = {}) {}

  onBegin(_config: FullConfig, suite: Suite): void {
    this.startedAt = Date.now();
    this.total = suite.allTests().length;
    // Rotate the journal before workers start so this run's summary contains
    // only this run's heals, while the previous run stays recoverable.
    rotateHealJournal();
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    // Heals are attached by the fixture as annotations and, in full, inside
    // the diagnostics payload. Read the journal at the end for the complete
    // picture across workers.
    if (result.status === 'passed' || result.status === 'skipped') return;
    if (result.status === 'failed' || result.status === 'timedOut') {
      this.failures.push({ test, result, diagnostics: readDiagnostics(result) });
    }
  }

  async onEnd(result: FullResult): Promise<void> {
    const cfg = getConfig();
    this.heals.push(...readHealJournal());

    const shouldAnalyze = this.options.analyze ?? cfg.analysis.enabled;
    const analyses: FailureAnalysis[] = [];

    // Only analyse failures that stayed failed — a test that passed on retry
    // is flaky, and we say so rather than diagnosing a transient.
    const toAnalyze = this.failures.slice(0, cfg.analysis.maxFailures);

    if (shouldAnalyze && toAnalyze.length) {
      process.stdout.write(`\n[aiqa] analysing ${toAnalyze.length} failure(s)...\n`);
      const results = await Promise.all(
        toAnalyze.map((f) =>
          analyzeFailure({
            testTitle: f.test.title,
            testFile: f.test.location.file,
            error: f.result.error?.message ?? null,
            stack: f.result.error?.stack ?? null,
            snippet: f.result.error?.snippet ?? null,
            durationMs: f.result.duration,
            flaky: f.test.outcome() === 'flaky',
            steps: f.result.steps.map((s) => s.title).slice(0, 40),
            ...(f.diagnostics ?? {}),
          }),
        ),
      );
      analyses.push(...results.filter((r): r is FailureAnalysis => r !== null));
    }

    this.printSummary(result, analyses);

    if (this.options.writeReport !== false) {
      this.writeReport(analyses);
    }
  }

  private writeReport(analyses: FailureAnalysis[]): void {
    const cfg = getConfig();
    const dir = this.options.outputDir ?? path.join(cfg.artifactsDir, 'report');
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'analysis.md'),
        renderAnalysisReport(analyses, this.heals),
        'utf8',
      );
      fs.writeFileSync(
        path.join(dir, 'analysis.json'),
        JSON.stringify({ generatedAt: new Date().toISOString(), heals: this.heals, analyses }, null, 2),
        'utf8',
      );
      if (analyses.length || this.heals.length) {
        process.stdout.write(`[aiqa] report written to ${path.relative(process.cwd(), dir)}/analysis.md\n`);
      }
    } catch (err) {
      process.stderr.write(`[aiqa] could not write report: ${(err as Error).message}\n`);
    }
  }

  private printSummary(result: FullResult, analyses: FailureAnalysis[]): void {
    const seconds = ((Date.now() - this.startedAt) / 1000).toFixed(1);
    const out: string[] = ['', '─'.repeat(64), `  aiqa summary  ·  ${this.total} test(s) in ${seconds}s  ·  ${result.status}`];

    if (this.heals.length) {
      const persisted = this.heals.filter((h) => h.persisted).length;
      const byTier = this.heals.reduce<Record<string, number>>((acc, h) => {
        acc[h.source] = (acc[h.source] ?? 0) + 1;
        return acc;
      }, {});
      out.push(
        '',
        `  Locators healed: ${this.heals.length} ` +
          `(${Object.entries(byTier).map(([k, v]) => `${k}: ${v}`).join(', ')})`,
      );
      for (const h of this.heals.slice(0, 10)) {
        out.push(
          `    · ${h.key}  ${Math.round(h.confidence * 100)}%  ${h.persisted ? '[written back]' : '[run only]'}`,
        );
        out.push(`        was: ${h.failedWith}`);
      }
      if (this.heals.length > 10) out.push(`    · ...and ${this.heals.length - 10} more`);

      // Say why, precisely. "Re-run with AI_HEAL_PERSIST=on" is bad advice
      // for a file that deliberately opted out of write-back.
      if (persisted < this.heals.length) {
        const reasons = new Map<string, number>();
        for (const h of this.heals) {
          if (h.persisted) continue;
          reasons.set(
            h.notPersistedBecause ?? 'unknown',
            (reasons.get(h.notPersistedBecause ?? 'unknown') ?? 0) + 1,
          );
        }
        const advice: Record<string, string> = {
          'persist-disabled':
            're-run with AI_HEAL_PERSIST=on to update the YAML (off by default in CI)',
          'opted-out': 'their locator file sets `meta.persistHeals: false`',
          'low-confidence': `below heal.persistMinConfidence — review and apply by hand`,
          fallback: 'a declared fallback matched; that is not drift, so nothing was rewritten',
          unknown: 'reason not recorded',
        };
        out.push('', '  Not written back:');
        for (const [reason, n] of reasons) {
          out.push(`    · ${n} × ${advice[reason] ?? reason}`);
        }
      }
    }

    if (analyses.length) {
      out.push('', `  Failures analysed: ${analyses.length}`);
      for (const a of analyses) {
        out.push(`    · [${a.category}] ${a.testTitle}`);
        out.push(`        ${a.summary}`);
      }
    }

    out.push('', `  AI usage: ${usageSummary()}`, '─'.repeat(64), '');
    process.stdout.write(out.join('\n'));
  }
}

/** Pull the `ai-diagnostics.json` attachment back out of a test result. */
function readDiagnostics(result: TestResult): DiagnosticsPayload | undefined {
  const attachment = result.attachments.find((a) => a.name === 'ai-diagnostics.json');
  if (!attachment) return undefined;
  try {
    const raw = attachment.body
      ? attachment.body.toString('utf8')
      : attachment.path
        ? fs.readFileSync(attachment.path, 'utf8')
        : undefined;
    return raw ? (JSON.parse(raw) as DiagnosticsPayload) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Heals are written to a JSONL journal by each worker. Reading the file here
 * is the only way the reporter process sees heals from every worker.
 */
function readHealJournal(): HealRecord[] {
  const file = path.join(getConfig().artifactsDir, 'heal-journal.jsonl');
  if (!fs.existsSync(file)) return [];
  try {
    return fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as HealRecord);
  } catch {
    return [];
  }
}

/** Move the previous run's journal aside so each run reports only its own. */
function rotateHealJournal(): void {
  const dir = getConfig().artifactsDir;
  const file = path.join(dir, 'heal-journal.jsonl');
  try {
    fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(file)) fs.renameSync(file, path.join(dir, 'heal-journal.prev.jsonl'));
  } catch {
    /* best effort — a stale journal only affects the summary, not the run */
  }
}
