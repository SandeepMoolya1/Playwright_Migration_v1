/**
 * Playwright configuration.
 *
 * Everything environment-specific comes from `config/environments.ts`, chosen
 * with `TEST_ENV`. Nothing in this file hardcodes a URL, a credential or a
 * per-environment timeout.
 *
 *   TEST_ENV=staging npm test
 *
 * Tuned for debuggability: every failure arrives with a trace, a video, a
 * screenshot and the AI diagnostics bundle already attached, so nobody has to
 * reproduce a CI failure locally to understand it.
 */
import { defineConfig, devices } from '@playwright/test';
import { ENVIRONMENT_NAMES, getEnvironment, getEnvironmentByName, storageStatePath } from './config/environments.js';

const env = getEnvironment();
const IS_CI = !!process.env.CI;
const FIXTURE_API_PORT = process.env.FIXTURE_API_PORT ?? '4010';

/** Shared or cold environments are slower; pad rather than make everything wait. */
const scale = (ms: number): number => Math.round(ms * env.timeoutFactor);

/**
 * Roles that need a signed-in session. The `auth` setup project logs each one
 * in once per run and saves its storage state; browser projects then start
 * already authenticated.
 *
 * Environments without users (the local demo) get no setup project at all, so
 * the repository stays runnable with zero configuration.
 */
const ROLES = Object.keys(env.users);
const NEEDS_AUTH = ROLES.length > 0 && env.authStrategy !== 'in-test';
const PER_ROLE = NEEDS_AUTH && env.authStrategy === 'per-role';

/**
 * Roles that only other environments define (e.g. KSP on staging). A test
 * tagged with one needs a session this environment cannot create, so outside
 * per-role mode it is excluded instead of failing on a missing user.
 */
const FOREIGN_ROLES = [
  ...new Set(ENVIRONMENT_NAMES.flatMap((name) => Object.keys(getEnvironmentByName(name).users))),
].filter((role) => !ROLES.includes(role));
const FOREIGN_ROLE_TAG = FOREIGN_ROLES.length
  ? new RegExp(`(?<![\\w-])@(${FOREIGN_ROLES.join('|')})(?![\\w-])`)
  : undefined;

const browsers = [
  { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
];

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  globalSetup: './global-setup.ts',

  // A locator that needs healing burns its full timeout first, so give the
  // test room. Individual actions stay tight via `actionTimeout`.
  timeout: scale(90_000),
  expect: { timeout: scale(10_000) },

  fullyParallel: true,
  forbidOnly: IS_CI,
  retries: IS_CI ? 2 : 0,
  workers: IS_CI ? 4 : undefined,

  reporter: [
    ['list'],
    ['html', { open: IS_CI ? 'never' : 'on-failure', outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'test-results/results.json' }],
    // The AI reporter runs last: it reads the other reporters' artifacts,
    // summarises healing, and writes .ai/report/analysis.md.
    ['./src/reporting/ai-reporter.ts'],
    ...(IS_CI ? [['github'] as const] : []),
  ],

  use: {
    baseURL: env.baseURL,
    extraHTTPHeaders: env.extraHTTPHeaders,
    ignoreHTTPSErrors: env.ignoreHTTPSErrors ?? true,

    // Must match `testIdAttribute` in aiqa.config.ts — the healer generates
    // getByTestId locators against this attribute.
    testIdAttribute: 'data-testid',

    // Debugging artifacts. `on-first-retry` keeps green runs fast while
    // guaranteeing a trace for anything that actually failed.
    trace: env.disableTrace ? 'off' : IS_CI ? 'on-first-retry' : 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',

    actionTimeout: scale(15_000),
    navigationTimeout: scale(30_000),

    // Deterministic rendering keeps traces and visual comparison stable.
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
    timezoneId: 'UTC',
  },

  projects: [
    // Signs in once per role and saves storage state for the browser projects.
    ...(PER_ROLE
      ? ROLES.map((role) => ({
          name: `auth-${role}`,
          testMatch: /auth\.setup\.ts/,
          // Playwright matches grep against "project file title", so no ^ anchor.
          grep: new RegExp(`authenticate as ${role}$`),
        }))
      : NEEDS_AUTH
        ? [{ name: 'auth', testMatch: /auth\.setup\.ts/ }]
        : []),

    ...(PER_ROLE
      ? browsers.flatMap((browser) =>
          ROLES.map((role) => ({
            ...browser,
            name: `${browser.name}-${role}`,
            // Only this role's tests (matched on the original `@<role>` tag).
            grep: new RegExp(`(?<![\\w-])@${role}(?![\\w-])`),
            use: { ...browser.use, storageState: storageStatePath(env.name, role) },
            dependencies: [`auth-${role}`],
          })),
        )
      : browsers.map((browser) => ({
          ...browser,
          ...(FOREIGN_ROLE_TAG ? { grepInvert: FOREIGN_ROLE_TAG } : {}),
          use: {
            ...browser.use,
            // Default every test to the first declared role. A test needing a
            // different one overrides it:  test.use({ storageState: ... })
            ...(NEEDS_AUTH ? { storageState: storageStatePath(env.name, ROLES[0]!) } : {}),
          },
          ...(NEEDS_AUTH ? { dependencies: ['auth'] } : {}),
        }))),
  ],

  // Servers started before the run. The fixture API backs the `local`
  // environment's apiURL so the API-seeding tests exercise a real HTTP
  // round-trip; it is skipped for any environment with its own API.
  webServer: [
    ...(env.name === 'local'
      ? [
          {
            command: `node tools/fixture-api.mjs`,
            url: `http://127.0.0.1:${FIXTURE_API_PORT}/_health`,
            reuseExistingServer: !IS_CI,
            timeout: 30_000,
            env: { FIXTURE_API_PORT: String(FIXTURE_API_PORT) },
          },
        ]
      : []),
    ...(process.env.WEB_SERVER_COMMAND
      ? [
          {
            command: process.env.WEB_SERVER_COMMAND,
            url: env.baseURL,
            reuseExistingServer: !IS_CI,
            timeout: scale(120_000),
          },
        ]
      : []),
  ],
});
