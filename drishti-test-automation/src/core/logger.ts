/**
 * Minimal leveled logger.
 *
 * Playwright hides worker stdout unless a test fails, so every heal is also
 * appended to the on-disk journal (`.ai/heal-journal.jsonl`) by the healer —
 * this logger is for the interactive case.
 */
const LEVELS = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 } as const;
export type LogLevel = keyof typeof LEVELS;

const ESC = String.fromCharCode(27);
const envLevel = (process.env.AI_LOG_LEVEL ?? 'info') as LogLevel;
const threshold = LEVELS[envLevel] ?? LEVELS.info;

const paint = (code: string, s: string): string =>
  process.stdout.isTTY ? `${ESC}[${code}m${s}${ESC}[0m` : s;

function emit(
  level: LogLevel,
  icon: string,
  color: string,
  scope: string,
  msg: string,
  extra?: unknown,
): void {
  if (LEVELS[level] > threshold) return;
  const line = `${paint(color, icon)} ${paint('2', `[${scope}]`)} ${msg}`;
  const stream = level === 'error' || level === 'warn' ? console.error : console.log;
  if (extra !== undefined) stream(line, extra);
  else stream(line);
}

export function createLogger(scope: string) {
  return {
    error: (m: string, e?: unknown) => emit('error', 'x', '31', scope, m, e),
    warn: (m: string, e?: unknown) => emit('warn', '!', '33', scope, m, e),
    info: (m: string, e?: unknown) => emit('info', 'i', '36', scope, m, e),
    heal: (m: string, e?: unknown) => emit('info', '+', '35', scope, m, e),
    ok: (m: string, e?: unknown) => emit('info', 'v', '32', scope, m, e),
    debug: (m: string, e?: unknown) => emit('debug', '.', '2', scope, m, e),
  };
}

export type Logger = ReturnType<typeof createLogger>;
