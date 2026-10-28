/**
 * Browser-side diagnostics capture.
 *
 * Playwright's trace already records everything, but a trace is a heavy
 * artifact and is not readable by the AI analyser. This collects the two
 * signals that explain most failures — console errors and failed network
 * calls — into plain structures we can both attach to the HTML report and
 * feed to the root-cause analyser.
 */
import type { ConsoleMessage, Page, Request, Response } from '@playwright/test';

export interface ConsoleEntry {
  type: string;
  text: string;
  location?: string;
  at: number;
}

export interface NetworkEntry {
  method: string;
  url: string;
  status?: number;
  statusText?: string;
  failure?: string;
  durationMs?: number;
  at: number;
}

export interface CaptureBuffers {
  console: ConsoleEntry[];
  network: NetworkEntry[];
  pageErrors: string[];
}

export interface CaptureOptions {
  console: boolean;
  network: boolean;
  networkFailuresOnly: boolean;
}

/** Cap buffers so a chatty app cannot exhaust worker memory. */
const MAX_ENTRIES = 300;

function push<T>(list: T[], item: T): void {
  if (list.length >= MAX_ENTRIES) list.shift();
  list.push(item);
}

/**
 * Attach listeners to a page. Returns the live buffers plus a `detach` to
 * call in teardown — leaked listeners across a worker's pages are a real
 * source of slow, confusing runs.
 */
export function attachCapture(page: Page, opts: CaptureOptions) {
  const buffers: CaptureBuffers = { console: [], network: [], pageErrors: [] };
  const started = new Map<string, number>();
  const disposers: Array<() => void> = [];

  const onConsole = (m: ConsoleMessage): void => {
    const type = m.type();
    // Info/debug chatter is noise; warnings and errors explain failures.
    if (type !== 'error' && type !== 'warning') return;
    const loc = m.location();
    push(buffers.console, {
      type,
      text: m.text().slice(0, 2000),
      location: loc.url ? `${loc.url}:${loc.lineNumber}` : undefined,
      at: Date.now(),
    });
  };

  const onPageError = (e: Error): void => {
    push(buffers.pageErrors, `${e.name}: ${e.message}`);
  };

  const onRequest = (r: Request): void => {
    started.set(r.url(), Date.now());
  };

  const onResponse = (r: Response): void => {
    const status = r.status();
    if (opts.networkFailuresOnly && status < 400) return;
    const begin = started.get(r.url());
    push(buffers.network, {
      method: r.request().method(),
      url: r.url().slice(0, 500),
      status,
      statusText: r.statusText(),
      durationMs: begin ? Date.now() - begin : undefined,
      at: Date.now(),
    });
  };

  const onRequestFailed = (r: Request): void => {
    const begin = started.get(r.url());
    push(buffers.network, {
      method: r.method(),
      url: r.url().slice(0, 500),
      failure: r.failure()?.errorText ?? 'request failed',
      durationMs: begin ? Date.now() - begin : undefined,
      at: Date.now(),
    });
  };

  if (opts.console) {
    page.on('console', onConsole);
    page.on('pageerror', onPageError);
    disposers.push(
      () => page.off('console', onConsole),
      () => page.off('pageerror', onPageError),
    );
  }

  if (opts.network) {
    page.on('request', onRequest);
    page.on('response', onResponse);
    page.on('requestfailed', onRequestFailed);
    disposers.push(
      () => page.off('request', onRequest),
      () => page.off('response', onResponse),
      () => page.off('requestfailed', onRequestFailed),
    );
  }

  return {
    buffers,
    detach: () => {
      for (const dispose of disposers) dispose();
      started.clear();
    },
  };
}

/** Markdown rendering used for report attachments and the analyser prompt. */
export function renderCapture(buffers: CaptureBuffers): string {
  const sections: string[] = [];

  if (buffers.pageErrors.length) {
    sections.push(
      `### Uncaught page errors (${buffers.pageErrors.length})\n` +
        buffers.pageErrors.map((e) => `- ${e}`).join('\n'),
    );
  }

  if (buffers.console.length) {
    sections.push(
      `### Console (${buffers.console.length})\n` +
        buffers.console
          .slice(-40)
          .map((c) => `- [${c.type}] ${c.text}${c.location ? `  (${c.location})` : ''}`)
          .join('\n'),
    );
  }

  if (buffers.network.length) {
    sections.push(
      `### Network problems (${buffers.network.length})\n` +
        buffers.network
          .slice(-40)
          .map(
            (n) =>
              `- ${n.method} ${n.url} -> ${n.failure ?? `${n.status} ${n.statusText ?? ''}`}` +
              `${n.durationMs !== undefined ? ` (${n.durationMs}ms)` : ''}`,
          )
          .join('\n'),
    );
  }

  return sections.length ? sections.join('\n\n') : '_No console or network problems captured._';
}
