#!/usr/bin/env node
/**
 * `aiqa` — the framework's command line.
 *
 * Uses `node:util`'s `parseArgs` rather than a CLI library: one fewer
 * dependency in a repo whose whole point is that the test stack stays
 * inspectable.
 */
import { parseArgs } from 'node:util';
import { createLogger } from '../core/logger.js';
import {
  cmdAudit,
  cmdCheck,
  cmdDoctor,
  cmdEnvs,
  cmdExplain,
  cmdGen,
  cmdList,
  cmdMigrate,
  cmdScan,
} from './commands.js';
import { currentEnvName, getEnvironmentByName } from '../../config/environments.js';

const log = createLogger('aiqa');

const HELP = `
  aiqa — AI-assisted Playwright tooling

  USAGE
    aiqa <command> [options]

  COMMANDS
    scan <url>              Build a YAML locator file from a live page
    gen "<goal>"            Explore an app and generate a spec + locators
    migrate                 Convert an existing Selenium/Java suite (incl. BDD)
    check                   Probe every locator against a live environment
    envs                    List the configured environments
    audit                   Static quality review of the locator repository
    list                    Show every locator the repository knows about
    explain                 Re-run AI failure analysis from saved artifacts
    doctor                  Check the environment and configuration

  SCAN
    aiqa scan https://app.test/login --name login
      --name <ns>           Locator namespace (default: inferred from the URL)
      --out <file>          Output path (default: locators/<name>.locators.yml)
      --scope <css>         Limit the scan to one region of the page
      --wait-for <css>      Wait for this selector before capturing
      --storage-state <f>   Reuse a saved auth state
      --headed              Show the browser
      --no-ai               Deterministic extraction only (offline, free)

  GEN
    aiqa gen "add a product to the cart and check out" --url https://app.test
      --url <url>           Starting URL (required)
      --name <ns>           Locator namespace for generated elements
      --out <dir>           Spec output dir (default: tests/e2e)
      --max-steps <n>       Cap on exploration actions (default: 18)
      --storage-state <f>   Reuse a saved auth state
      --headed              Watch the exploration happen

  MIGRATE
    aiqa migrate --input ./legacy-selenium --apply
      --input <dir>         Selenium sources (default: SELENIUM_PROJECT_PATH from .env)
      --out <dir>           Draft output (default: migration/output)
      --apply               Also install into locators/, tests/e2e/, src/pages/
      --url <url>           meta.url for the generated locator files
      --analyze             Report what was found, write nothing

    Handles plain TestNG/JUnit page-object suites and Cucumber BDD
    (.feature files + step definitions). Everything it cannot translate
    becomes a TODO(migration) rather than a guess.

  CHECK
    aiqa check --env staging --fix
      --env <name>          Environment from config/environments.ts
      --base-url <url>      Explicit URL, overriding --env
      --only <ns>           Restrict to one namespace
      --fix                 Write drifted locators back into the YAML
      --headed              Show the browser

  EXPLAIN
    aiqa explain --input test-results
      --input <dir>         Where to find ai-diagnostics.json (default: test-results)

  ENVIRONMENTS
    Every command accepts --env <name> (or the TEST_ENV variable), resolved
    from config/environments.ts. It selects the base URL, the users, the
    feature flags and which .env.<name> file is loaded.

      aiqa check --env staging
      TEST_ENV=staging npx aiqa check

  ENVIRONMENT VARIABLES
    TEST_ENV                Environment name (default: local)
    SELENIUM_PROJECT_PATH   Selenium repository to migrate from (read-only)
    ANTHROPIC_API_KEY       Credentials (or run \`ant auth login\`)
    AI_HEAL=on|off          Master switch for runtime healing
    AI_HEAL_PERSIST=on|off  Write heals back to YAML
    AI_HEAL_STRICT=on       Fail tests that needed healing (drift gate for CI)
    AI_ANALYSIS=on|off      AI root-cause analysis in the reporter
    AI_MODEL=<id>           Override the model (default: claude-opus-5)
    AI_LOG_LEVEL=debug      Verbose framework logging
`;

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2);

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }

  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    strict: false,
    options: {
      env: { type: 'string' },
      name: { type: 'string' },
      out: { type: 'string' },
      url: { type: 'string' },
      scope: { type: 'string' },
      only: { type: 'string' },
      input: { type: 'string' },
      'base-url': { type: 'string' },
      'wait-for': { type: 'string' },
      'storage-state': { type: 'string' },
      'max-steps': { type: 'string' },
      apply: { type: 'boolean' },
      analyze: { type: 'boolean' },
      headed: { type: 'boolean' },
      fix: { type: 'boolean' },
      json: { type: 'boolean' },
      'no-ai': { type: 'boolean' },
    },
  });

  const str = (k: string): string | undefined => {
    const v = values[k];
    return typeof v === 'string' ? v : undefined;
  };
  const flag = (k: string): boolean => values[k] === true;

  // Must happen before any command resolves the environment or loads config:
  // TEST_ENV selects which .env file wins and which registry entry is used.
  const envName = str('env');
  if (envName) process.env.TEST_ENV = envName;

  switch (command) {
    case 'scan': {
      const url = positionals[0] ?? str('url');
      if (!url) return fail('scan requires a URL:  aiqa scan https://app.test/login');
      return cmdScan({
        url,
        name: str('name'),
        out: str('out'),
        scope: str('scope'),
        waitFor: str('wait-for'),
        storageState: str('storage-state'),
        headed: flag('headed'),
        noAi: flag('no-ai'),
      });
    }

    case 'gen': {
      const goal = positionals.join(' ').trim();
      const url = str('url');
      if (!goal) return fail('gen requires a goal:  aiqa gen "log in and open the dashboard" --url ...');
      if (!url) return fail('gen requires --url');
      const maxSteps = Number(str('max-steps'));
      return cmdGen({
        goal,
        url,
        name: str('name'),
        out: str('out'),
        headed: flag('headed'),
        maxSteps: Number.isFinite(maxSteps) ? maxSteps : undefined,
        storageState: str('storage-state'),
      });
    }

    case 'check': {
      // `--base-url` wins; otherwise resolve it from the environment registry.
      const baseUrl =
        str('base-url') ?? positionals[0] ?? resolveBaseUrl(envName);
      if (!baseUrl) return fail('check requires --env or --base-url');
      return cmdCheck({
        baseUrl,
        fix: flag('fix'),
        only: str('only'),
        headed: flag('headed'),
        storageState: str('storage-state'),
      });
    }

    case 'migrate':
      return cmdMigrate({
        input: str('input') ?? positionals[0],
        out: str('out'),
        apply: flag('apply'),
        url: str('url'),
        analyzeOnly: flag('analyze'),
      });

    case 'envs':
      return cmdEnvs();

    case 'audit':
      return cmdAudit();

    case 'list':
      return cmdList({ json: flag('json') });

    case 'explain':
      return cmdExplain({ input: str('input') });

    case 'doctor':
      return cmdDoctor();

    default:
      return fail(`unknown command "${command}". Run \`aiqa help\`.`);
  }
}

/** Base URL for the selected environment, or the default one. */
function resolveBaseUrl(envName: string | undefined): string | undefined {
  try {
    return getEnvironmentByName(envName ?? currentEnvName()).baseURL;
  } catch (err) {
    log.error((err as Error).message);
    return undefined;
  }
}

function fail(message: string): number {
  log.error(message);
  return 1;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    log.error((err as Error).message);
    if (process.env.AI_LOG_LEVEL === 'debug') console.error(err);
    process.exitCode = 1;
  });
