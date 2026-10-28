/**
 * Regenerate the in-repo migration drafts from a Selenium/Cucumber checkout.
 *
 *   npm run migrate:drafts -- [--input <selenium-repo>] [--env staging] [--dry-run]
 *
 * The Selenium repository root (or its src/test/java) comes from `--input`, else
 * `SELENIUM_PROJECT_PATH` in `.env` (see src/migration/source-path.ts). It is only
 * read. See src/migration/drafts.ts for what is written, and
 * .claude/skills/aiqa-ksp-migration for the workflow around it.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { getEnvironmentByName } from '../config/environments.js';
import { generateDrafts } from '../src/migration/drafts.js';
import { resolveSeleniumSource, SeleniumPathError } from '../src/migration/source-path.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const envName = arg('env') ?? 'staging';
if (arg('env')) process.env.TEST_ENV = envName;

let repoRoot: string;
try {
  repoRoot = resolveSeleniumSource(arg('input')).root;
} catch (e) {
  if (!(e instanceof SeleniumPathError)) throw e;
  process.stderr.write(`error: ${e.message}\nusage: npm run migrate:drafts -- [--input <selenium-repo>] [--env staging] [--dry-run]\n`);
  process.exit(1);
}
const javaRoot = fs.existsSync(path.join(repoRoot, 'src', 'test', 'java')) ? path.join(repoRoot, 'src', 'test', 'java') : repoRoot;

const git = (...args: string[]): string => {
  try {
    return execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};
const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
const commit = git('rev-parse', '--short', 'HEAD');
const dirty = git('status', '--short') ? ' + uncommitted changes' : '';
const sourceLabel = `${path.basename(repoRoot)}${branch ? `@${branch} ${commit}${dirty}` : ''}`;

const summary = generateDrafts({
  input: javaRoot,
  rootDir: process.cwd(),
  sourceLabel,
  knownRoles: Object.keys(getEnvironmentByName(envName).users),
  dryRun: process.argv.includes('--dry-run'),
});

const total = (k: 'scenarios' | 'drafted' | 'todoSteps' | 'unboundSteps'): number =>
  summary.features.reduce((a, f) => a + f[k], 0);
process.stdout.write(
  [
    `source            ${sourceLabel}`,
    `features          ${summary.features.length}`,
    `scenario rows     ${total('scenarios')} (drafted ${total('drafted')}, already migrated ${summary.features.reduce((a, f) => a + f.alreadyMigrated.length, 0)})`,
    `TODO / unbound    ${total('todoSteps')} / ${total('unboundSteps')} steps`,
    `page objects      ${summary.pages.length}, locators added ${summary.pages.reduce((a, p) => a + p.added, 0)}`,
    `files written     ${summary.written.length}${process.argv.includes('--dry-run') ? ' (dry run — nothing written)' : ''}`,
    'report            docs/migration-drafts-report.md',
    '',
  ].join('\n'),
);
