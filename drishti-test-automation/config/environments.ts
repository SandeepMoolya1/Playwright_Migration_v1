/**
 * Environment registry.
 *
 * One place that answers "what does `staging` mean": its URLs, its users, its
 * quirks, and whether it is safe to write data to it. Everything else in the
 * framework — the Playwright config, the fixtures, the data seeder and the
 * `aiqa` CLI — reads the resolved environment from here.
 *
 * Select with `TEST_ENV`:
 *
 *   TEST_ENV=staging npm test
 *   TEST_ENV=staging npx aiqa check
 *
 * Secrets are never written in this file. They are read from the environment,
 * and read *lazily* — running against `local` must not require staging
 * credentials to be present.
 */
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { credsProperty } from './creds-file.js';

export interface UserCredentials {
  username: string;
  password: string;
  /** Free-form; useful for asserting role-specific UI. */
  displayName?: string;
}

export interface EnvironmentConfig {
  /** Short name, as passed to TEST_ENV. */
  name: string;
  /** Human label used in reports and log lines. */
  label: string;
  /** Application under test. Must end with a slash if it has a path. */
  baseURL: string;
  /** REST/GraphQL root used for data seeding. Omit when there is none. */
  apiURL?: string;

  /**
   * Hard guard. When true, the data seeder refuses to create, modify or
   * delete anything. Production is read-only; so is any shared environment
   * you do not own.
   */
  readOnly: boolean;

  /**
   * Multiplies every timeout. Shared or cold environments are slower than a
   * local dev server, and padding timeouts per-environment beats making every
   * test wait for the worst case.
   */
  timeoutFactor: number;

  /**
   * Feature flags that legitimately change what a test should expect. Read
   * them with the `env` fixture and branch, rather than forking the spec.
   */
  features: Record<string, boolean>;

  /** Users by role. Values are resolved lazily — see `secret()`. */
  users: Record<string, UserCredentials>;

  /**
   * Additional named users that tests sign in as themselves (e.g. Selenium's
   * data-column users such as KSP_User6). They get NO auth project and no
   * storage state, so they never add logins to, or depend on, a role's auth.
   */
  extraUsers?: Record<string, UserCredentials>;

  /** Sent on every request: WAF bypass tokens, tenant pinning, tracing. */
  extraHTTPHeaders?: Record<string, string>;

  /** Ignore TLS errors (self-signed certs on ephemeral environments). */
  ignoreHTTPSErrors?: boolean;

  /**
   * Entry path relative to `baseURL`, including any query string, for
   * applications whose landing URL is not just `baseURL` (e.g. `?language=en_US`).
   * Kept separate because baseURL is normalised to end with "/".
   */
  startPath?: string;

  /**
   * `setup` (default): one `auth` project signs every role in and browser
   * projects default to the first role. `per-role`: an `auth-<role>` project
   * and `<browser>-<role>` projects per role; a browser-role project runs the
   * tests tagged `@<role>` and depends only on its own role's auth project.
   * `in-test`: no auth project; tests sign in themselves.
   */
  authStrategy?: 'setup' | 'per-role' | 'in-test';

  /**
   * Turn Playwright traces off. A trace records every `fill()` value, so any
   * environment whose tests type real credentials must not produce traces.
   */
  disableTrace?: boolean;
}

/**
 * Read a required secret at the moment it is used, not at import time.
 * A missing staging password must fail the staging run with a clear message,
 * never break `npm test` against `local`.
 */
function secret(variable: string): string {
  const value = process.env[variable];
  if (!value) {
    throw new Error(
      `Missing required environment variable "${variable}".\n` +
        `  It is needed by the "${currentEnvName()}" environment.\n` +
        `  Set it in .env.${currentEnvName()} (gitignored) or in your CI secrets.`,
    );
  }
  return value;
}

/** A credentials object whose fields resolve only when actually read. */
function lazyUser(userVar: string, passVar: string, displayName?: string): UserCredentials {
  return {
    get username() {
      return secret(userVar);
    },
    get password() {
      return secret(passVar);
    },
    displayName,
  };
}

/** Credentials resolved lazily: env var named after the key, else the `CREDS_FILE_PATH` properties file. */
function fileUser(userKey: string, passKey: string, displayName?: string): UserCredentials {
  return {
    get username() {
      return credsProperty(userKey);
    },
    get password() {
      return credsProperty(passKey);
    },
    displayName,
  };
}

/* ------------------------------------------------------------------ registry */

const REGISTRY: Record<string, () => EnvironmentConfig> = {
  /**
   * Default. Points at the public TodoMVC demo so the repository is runnable
   * with zero setup. Replace `baseURL` with your own dev server, or set
   * WEB_SERVER_COMMAND and Playwright will start one.
   */
  local: () => ({
    name: 'local',
    label: 'Local / demo',
    baseURL: process.env.BASE_URL ?? 'https://demo.playwright.dev/todomvc/',
    // The bundled fixture API (tools/fixture-api.mjs), started automatically
    // by playwright.config.ts. It exists so the framework's own API-seeding
    // path is exercised for real. Point this at your API and delete that file.
    apiURL: process.env.API_URL ?? `http://127.0.0.1:${process.env.FIXTURE_API_PORT ?? 4010}/`,
    readOnly: false,
    timeoutFactor: 1,
    features: { promoCodes: true, newCheckout: true },
    users: {},
  }),

  dev: () => ({
    name: 'dev',
    label: 'Development',
    baseURL: process.env.BASE_URL ?? 'https://dev.app.test/',
    apiURL: process.env.API_URL ?? 'https://api.dev.app.test/',
    readOnly: false,
    timeoutFactor: 1.5,
    features: { promoCodes: true, newCheckout: true },
    users: {
      standard: lazyUser('DEV_USER', 'DEV_PASSWORD', 'Dev User'),
      admin: lazyUser('DEV_ADMIN_USER', 'DEV_ADMIN_PASSWORD', 'Dev Admin'),
    },
    ignoreHTTPSErrors: true,
  }),

  /**
   * Keysight Support STG. Pinned: BASE_URL is deliberately NOT honoured here,
   * so a stray variable can never redirect a run to another environment.
   * Full entry URL: https://stgsupport.keysight.com/s/?language=en_US
   * (`baseURL` + `startPath`; `ui.goto(env.startPath)` opens it).
   * Credentials come from the external file named by CREDS_FILE_PATH.
   */
  staging: () => ({
    name: 'staging',
    label: 'Keysight Support STG',
    baseURL: 'https://stgsupport.keysight.com/s/',
    startPath: '?language=en_US',
    readOnly: false,
    // The Selenium suite waits up to 40s per condition; 4x keeps parity.
    timeoutFactor: 4,
    features: {},
    // Roles keep the Selenium names. Each role resolves only its own keys,
    // so one role's missing credentials never affect another role's tests.
    users: {
      KSP: fileUser('KSP_Username', 'KSP_Password', 'KSP'),
      CAMSTHALES: fileUser('CAMSTHALES_Username', 'CAMSTHALES_Password', 'CAMSTHALES'),
      BMW: fileUser('BMW_Username', 'BMW_Password', 'BMW'),
    },
    extraUsers: {
      KSP_User4: fileUser('KSP_TM_Username4', 'KSP_TM_Password4', 'KSP_User4'),
      KSP_User6: fileUser('KSP_TM_Username6', 'KSP_TM_Password6', 'KSP_User6'),
    },
    // One `auth-<role>` setup project and one `<browser>-<role>` project per
    // role: running a role's tests authenticates only that role.
    authStrategy: 'per-role',
    disableTrace: true,
  }),

  /**
   * Keysight Support QA (Salesforce sandbox `sfcamsqa`), same URL as Selenium's
   * qaconfig.properties. Opt-in only: runs when TEST_ENV=qa is set explicitly.
   * Reuses the same role -> credential keys as staging (as Selenium does);
   * QA accounts/state are NOT assumed to equal STG's, so storage state is kept
   * per environment (`.auth/qa-<role>.json`).
   */
  qa: () => ({
    name: 'qa',
    label: 'Keysight Support QA',
    baseURL: 'https://keysightsales--sfcamsqa.sandbox.my.site.com/KeysightdCX/s/',
    startPath: '?language=en_US',
    readOnly: false,
    timeoutFactor: 4,
    features: {},
    users: {
      KSP: fileUser('KSP_Username', 'KSP_Password', 'KSP'),
      CAMSTHALES: fileUser('CAMSTHALES_Username', 'CAMSTHALES_Password', 'CAMSTHALES'),
      BMW: fileUser('BMW_Username', 'BMW_Password', 'BMW'),
    },
    extraUsers: {
      KSP_User4: fileUser('KSP_TM_Username4', 'KSP_TM_Password4', 'KSP_User4'),
      KSP_User6: fileUser('KSP_TM_Username6', 'KSP_TM_Password6', 'KSP_User6'),
    },
    authStrategy: 'per-role',
    disableTrace: true,
  }),

  /**
   * Production smoke checks only. `readOnly` makes the seeder refuse to write,
   * so a test that tries to create fixture data fails loudly instead of
   * polluting real data.
   */
  prod: () => ({
    name: 'prod',
    label: 'Production (read-only)',
    baseURL: process.env.BASE_URL ?? 'https://app.test/',
    readOnly: true,
    timeoutFactor: 2,
    features: { promoCodes: true, newCheckout: false },
    users: {
      smoke: lazyUser('PROD_SMOKE_USER', 'PROD_SMOKE_PASSWORD', 'Smoke User'),
    },
  }),
};

export const ENVIRONMENT_NAMES = Object.keys(REGISTRY);

/* ------------------------------------------------------------- resolution */

/**
 * `TEST_ENV` from the shell wins; otherwise it may come from `.env`. It has
 * to be peeked at (not loaded) because it decides which `.env.<name>` file
 * loads first, and dotenv never overwrites a variable once set.
 */
export function currentEnvName(): string {
  if (process.env.TEST_ENV) return process.env.TEST_ENV;
  const file = path.join(process.cwd(), '.env');
  if (fs.existsSync(file)) {
    const fromFile = dotenv.parse(fs.readFileSync(file)).TEST_ENV;
    if (fromFile) return fromFile;
  }
  return 'local';
}

let dotenvLoaded = false;

/**
 * Load `.env.<name>` then `.env`.
 *
 * Variables that are already set are never overwritten, so the order
 * gives: real environment (CI secrets) > `.env.<name>` > `.env`. That is the
 * behaviour you want — CI must always win over a file on disk.
 */
function loadDotenv(name: string): void {
  if (dotenvLoaded) return;
  dotenvLoaded = true;
  const root = process.cwd();
  for (const file of [`.env.${name}`, '.env']) {
    const full = path.join(root, file);
    if (!fs.existsSync(full)) continue;
    // Same rule as dotenv (never overwrite what is set), plus: `KEY=` with no
    // value means "not set", so a template copied as-is keeps every default.
    for (const [key, value] of Object.entries(dotenv.parse(fs.readFileSync(full)))) {
      if (value !== '' && process.env[key] === undefined) process.env[key] = value;
    }
  }
}

/**
 * Load `.env.<TEST_ENV>` then `.env`, in that order.
 *
 * Exported because `src/core/config.ts` must not call `dotenv/config` itself:
 * that would load plain `.env` first, and since dotenv never overwrites an
 * existing variable, the environment-specific file could no longer override
 * it. Ordering is the whole point, so there is exactly one loader.
 */
export function loadEnvFiles(): void {
  loadDotenv(currentEnvName());
}

let resolved: EnvironmentConfig | undefined;

/** The environment this process is running against. Cached. */
export function getEnvironment(): EnvironmentConfig {
  if (resolved) return resolved;

  const name = currentEnvName();
  loadDotenv(name);

  const build = REGISTRY[name];
  if (!build) {
    throw new Error(
      `Unknown TEST_ENV "${name}". Known environments: ${ENVIRONMENT_NAMES.join(', ')}.\n` +
        `  Add it to config/environments.ts, or pick one of the above.`,
    );
  }

  const env = build();

  // `new URL(path, baseURL)` silently discards the base path when baseURL has
  // no trailing slash — the single most common cause of "404 in staging only".
  if (!env.baseURL.endsWith('/')) env.baseURL = `${env.baseURL}/`;

  resolved = env;
  return env;
}

/** Resolve a named environment without changing the current one (CLI use). */
export function getEnvironmentByName(name: string): EnvironmentConfig {
  const build = REGISTRY[name];
  if (!build) {
    throw new Error(
      `Unknown environment "${name}". Known: ${ENVIRONMENT_NAMES.join(', ')}.`,
    );
  }
  loadDotenv(name);
  const env = build();
  if (!env.baseURL.endsWith('/')) env.baseURL = `${env.baseURL}/`;
  return env;
}

/** Where a role's signed-in storage state is cached. */
export function storageStatePath(envName: string, role: string): string {
  return path.join(process.cwd(), '.auth', `${envName}-${role}.json`);
}

/** Throws unless the environment permits writes. Used by the data seeder. */
export function assertWritable(env: EnvironmentConfig, action: string): void {
  if (!env.readOnly) return;
  throw new Error(
    `Refusing to ${action} in "${env.name}" — it is marked readOnly.\n` +
      `  Read-only environments are never seeded or mutated by tests.\n` +
      `  If this test needs fixture data, it must not run against ${env.name}: ` +
      `guard it with \`test.skip(env.readOnly, '...')\`.`,
  );
}
