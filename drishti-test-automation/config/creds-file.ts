/**
 * Central credential provider.
 *
 * Primary: `CREDENTIALS_FILE` points at a credentials file supplied at run
 * time. Two formats, chosen by extension:
 *   - `.json`  — flat object `{ "KSP_Username": "...", "KSP_Password": "..." }`
 *                (see `credentials.example.json`);
 *   - anything else — Java `.properties`, the same file the Selenium suite
 *                takes via `-DcredsFilePath`.
 * `CREDS_FILE_PATH` is accepted as a backward-compatible alias.
 *
 * Optional override: an environment variable named exactly like a key
 * (`KSP_Username`, ...) wins over the file for that key.
 *
 * The file must live outside version control and is never copied or logged.
 * Error messages name files and credential *keys* only — never values or
 * file contents.
 */
import fs from 'node:fs';
import path from 'node:path';

export const CREDS_FILE_ENV = 'CREDENTIALS_FILE';
const LEGACY_CREDS_FILE_ENV = 'CREDS_FILE_PATH';

/** Path of the credentials file for this run, from `CREDENTIALS_FILE` (or the legacy name). */
function credsFilePath(): string | undefined {
  return process.env[CREDS_FILE_ENV] || process.env[LEGACY_CREDS_FILE_ENV] || undefined;
}

let cache: { path: string; props: Map<string, string> } | undefined;

/** Java `Properties` escape handling: \t \n \r \f \uXXXX, anything else drops the backslash. */
function unescapeValue(raw: string): string {
  return raw.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_m, seq: string) => {
    if (seq.length === 5) return String.fromCharCode(parseInt(seq.slice(1), 16));
    return { t: '\t', n: '\n', r: '\r', f: '\f' }[seq] ?? seq;
  });
}

/** Same rules as `java.util.Properties`: `#`/`!` comments, `=` / `:` / whitespace separators, last key wins. */
export function parseProperties(text: string): Map<string, string> {
  const props = new Map<string, string>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/^\s+/, '');
    if (line === '' || line.startsWith('#') || line.startsWith('!')) continue;
    const match = /^((?:\\.|[^\s=:\\])+)\s*(?:[=:]\s*|\s+)?(.*)$/.exec(line);
    if (!match) continue;
    props.set(unescapeValue(match[1]!), unescapeValue(match[2] ?? ''));
  }
  return props;
}

/** Flat `{ key: string }` JSON. Parser messages can quote file content, so they are never surfaced. */
export function parseJsonCreds(text: string, filePath: string): Map<string, string> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Credentials file "${filePath}" is not valid JSON.`);
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error(`Credentials file "${filePath}" must contain a flat JSON object of "Key": "value" pairs.`);
  }
  const props = new Map<string, string>();
  for (const [key, value] of Object.entries(data)) {
    if (typeof value !== 'string') {
      throw new Error(`Credentials file "${filePath}": the value for key "${key}" must be a string.`);
    }
    props.set(key, value);
  }
  return props;
}

function load(filePath: string): Map<string, string> {
  if (cache?.path === filePath) return cache.props;

  let text: string;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    throw new Error(
      `Credentials file "${filePath}" is missing or not readable (${(err as NodeJS.ErrnoException).code ?? 'error'}).`,
    );
  }
  const props =
    path.extname(filePath).toLowerCase() === '.json' ? parseJsonCreds(text, filePath) : parseProperties(text);
  cache = { path: filePath, props };
  return props;
}

/**
 * Read one credential. Resolution order:
 *   1. a runtime environment variable named exactly like the key;
 *   2. the file named by `CREDENTIALS_FILE` (or legacy `CREDS_FILE_PATH`).
 * A key that is absent *or empty* everywhere is reported by name; the value
 * itself is never included in any message.
 */
export function credsProperty(key: string): string {
  const fromEnv = process.env[key];
  if (fromEnv) return fromEnv;

  const filePath = credsFilePath();
  if (!filePath) {
    throw new Error(
      `Credential "${key}" is not set.\n` +
        `  Set ${CREDS_FILE_ENV} to your credentials file (e.g. $env:${CREDS_FILE_ENV}="C:\\path\\to\\credentials.json"), ` +
        `or provide $env:${key} directly.`,
    );
  }
  const value = load(filePath).get(key);
  if (value === undefined || value === '') {
    throw new Error(
      `Credential "${key}" is missing or empty in the credentials file ("${filePath}") and no $env:${key} override is set.`,
    );
  }
  return value;
}

/** Which of the given keys are unresolved by env var or file — for diagnostics that must not print values. */
export function missingCredsKeys(keys: string[]): string[] {
  return keys.filter((k) => {
    try {
      credsProperty(k);
      return false;
    } catch {
      return true;
    }
  });
}
