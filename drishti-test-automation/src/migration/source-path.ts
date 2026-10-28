/**
 * Single resolver for the Selenium source project path.
 *
 * Precedence: explicit `--input` > `SELENIUM_PROJECT_PATH` (shell/CI variable,
 * else `.env.<TEST_ENV>` / `.env` via loadEnvFiles). There is no default
 * location: a missing or wrong path is an error, never a silent fallback.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadEnvFiles } from '../../config/environments.js';

export const SELENIUM_PATH_VAR = 'SELENIUM_PROJECT_PATH';

export interface SeleniumSource {
  /** Absolute directory. Only ever read. */
  root: string;
  origin: '--input' | typeof SELENIUM_PATH_VAR;
}

export class SeleniumPathError extends Error {}

export function resolveSeleniumSource(input?: string): SeleniumSource {
  loadEnvFiles();

  const explicit = input?.trim();
  const fromEnv = process.env[SELENIUM_PATH_VAR]?.trim();
  const origin = explicit ? '--input' : SELENIUM_PATH_VAR;
  const value = explicit || fromEnv;

  if (!value) {
    throw new SeleniumPathError(
      `${SELENIUM_PATH_VAR} is not set.\n` +
        `  Add it to .env (see .env.example), e.g.  ${SELENIUM_PATH_VAR}=<path to your Selenium repository>\n` +
        `  or pass --input <dir>.`,
    );
  }

  const root = path.resolve(value);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new SeleniumPathError(
      `Selenium source from ${origin} does not exist or is not a directory: ${root}\n` +
        (origin === '--input'
          ? '  Check the --input value.'
          : `  Fix ${SELENIUM_PATH_VAR} in .env (or the shell variable that overrides it).`),
    );
  }
  return { root, origin };
}
