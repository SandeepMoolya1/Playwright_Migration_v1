/**
 * Framework configuration. Every field is optional — these are overrides on
 * top of the built-in defaults, and environment variables override this file.
 *
 * See src/core/config.ts for the full shape and the defaults.
 */
import type { AiqaConfig } from './src/core/config.js';

const config: Partial<AiqaConfig> = {
  // Must match `use.testIdAttribute` in playwright.config.ts.
  testIdAttribute: 'data-testid',

  heal: {
    enabled: true,
    // Locally: write healed locators back so the repo self-maintains.
    // CI sets CI=true, which flips this off — CI reports drift, humans fix it.
    persist: !process.env.CI,
    minConfidence: 0.7,
    heuristicMinScore: 0.45,
    persistMinConfidence: 0.85,
    timeoutMs: 45_000,
    maxPerRun: 25,
    cache: true,
    // Turn on in a dedicated "locator drift" CI job to fail the build when a
    // test only passed because it was healed.
    strict: false,
  },

  analysis: {
    enabled: !!process.env.CI,
    maxFailures: 10,
  },

  ai: {
    model: 'claude-opus-5',
    fastModel: 'claude-haiku-4-5',
    effort: 'medium',
    maxTokens: 8000,
    maxSnapshotChars: 60_000,
  },

  capture: {
    console: true,
    network: true,
    networkFailuresOnly: true,
  },
};

export default config;
