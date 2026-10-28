/**
 * The framework's `test` object. Specs import from here, never from
 * `@playwright/test` directly.
 *
 *   import { test, expect } from '../../src/fixtures/index.js';
 *
 *   test('login', async ({ ui }) => {
 *     await ui.goto('/login');
 *     await ui.fill('login.usernameInput', 'standard_user');
 *     await ui.click('login.submitButton');
 *     await ui.expect('inventory.header').toBeVisible();
 *   });
 *
 * Fixtures provided:
 *   ui          - action surface keyed by locator name, with auto-healing
 *   find        - raw locator resolution, for anything `ui` does not cover
 *   locators    - the YAML repository (keys(), has(), get())
 *   heals       - heal records produced by the current test
 *   diagnostics - console/network buffers for the current test
 */
import { test as base, expect, type Locator } from '@playwright/test';
import { getEnvironment, type EnvironmentConfig } from '../../config/environments.js';
import { getConfig } from '../core/config.js';
import { createLogger } from '../core/logger.js';
import { getRepository, type LocatorRepository } from '../locators/repository.js';
import { resolveWithHealing } from '../ai/healer.js';
import { captureAria } from '../dom/snapshot.js';
import { attachCapture, renderCapture, type CaptureBuffers } from './capture.js';
import { SmartPage, type Finder } from './smart-page.js';
import { AppState } from '../data/app-state.js';
import { getDataset, type Dataset } from '../data/dataset.js';
import { factory, type Factory } from '../data/factory.js';
import { Seeder } from '../data/seeder.js';
import type { HealRecord } from '../core/types.js';

const log = createLogger('test');

export interface AiFixtures {
  locators: LocatorRepository;
  find: Finder;
  ui: SmartPage;
  heals: HealRecord[];
  diagnostics: CaptureBuffers;

  /** The resolved environment: URLs, feature flags, readOnly, users. */
  env: EnvironmentConfig;
  /** Reference data that already exists in this environment. */
  dataset: Dataset;
  /** Builders for test-owned data, tagged with the run id. */
  data: Factory;
  /** Seed app state directly: storage, cookies, request stubs. */
  state: AppState;
  /** Create fixture data over the API. Cleaned up automatically. */
  seed: Seeder;
}

export const test = base.extend<AiFixtures>({
  locators: async ({}, use) => {
    await use(getRepository());
  },

  env: async ({}, use) => {
    await use(getEnvironment());
  },

  dataset: async ({ env }, use) => {
    await use(getDataset(env.name));
  },

  data: async ({}, use) => {
    await use(factory);
  },

  state: async ({ page, context }, use) => {
    await use(new AppState(page, context));
  },

  seed: async ({ env, request }, use) => {
    const seeder = new Seeder({ env, request });
    await use(seeder);
    // Runs even when the test fails, so a red test never leaves data behind.
    await seeder.cleanup();
  },

  // Auto fixture: wire console/network capture before the test body runs and
  // attach everything the reporter (and the AI analyser) needs on failure.
  diagnostics: [
    async ({ page }, use, testInfo) => {
      const cfg = getConfig();
      // Reset here rather than in the `heals` fixture: this one is `auto`, so
      // it always runs, even for a test that never resolves a locator.
      healsForTest = [];
      const capture = attachCapture(page, cfg.capture);

      await use(capture.buffers);

      capture.detach();

      const failed = testInfo.status !== testInfo.expectedStatus;
      if (!failed) return;

      // An aria snapshot at the moment of failure is the single most useful
      // artifact for diagnosing a locator problem after the fact.
      let aria = '';
      try {
        aria = await captureAria(page);
      } catch {
        /* the page may already be closed */
      }

      const payload = {
        testTitle: testInfo.title,
        testFile: testInfo.file,
        url: page.url(),
        error: testInfo.error?.message ?? null,
        stack: testInfo.error?.stack ?? null,
        // `snippet` (the source code frame) is present at runtime but is not
        // part of the public TestInfoError type.
        snippet: (testInfo.error as { snippet?: string } | undefined)?.snippet ?? null,
        console: capture.buffers.console,
        network: capture.buffers.network,
        pageErrors: capture.buffers.pageErrors,
        heals: healsForTest,
        aria: aria.slice(0, 40_000),
      };

      await testInfo.attach('ai-diagnostics.json', {
        body: JSON.stringify(payload, null, 2),
        contentType: 'application/json',
      });
      await testInfo.attach('ai-diagnostics.md', {
        body: [
          `# Diagnostics: ${testInfo.title}`,
          `\nURL at failure: ${page.url()}`,
          healsForTest.length
            ? `\n### Locators healed during this test (${healsForTest.length})\n` +
              healsForTest
                .map(
                  (h) =>
                    `- \`${h.key}\` via **${h.source}** (${Math.round(h.confidence * 100)}%): ` +
                    `${h.failedWith} -> ${JSON.stringify(h.healedWith)}`,
                )
                .join('\n')
            : '',
          `\n${renderCapture(capture.buffers)}`,
        ]
          .filter(Boolean)
          .join('\n'),
        contentType: 'text/markdown',
      });
    },
    { auto: true },
  ],

  heals: async ({ diagnostics }, use) => {
    void diagnostics; // ordering: ensure the auto fixture has reset the buffer
    await use(healsForTest);
  },

  find: async ({ page, locators, heals }, use, testInfo) => {
    const finder: Finder = async (key, opts) => {
      const element = locators.get(key);
      const { locator, healed } = await resolveWithHealing({
        page,
        element,
        timeout: opts?.timeout ?? testInfo.timeout / 6,
        testTitle: testInfo.title,
      });
      if (healed) {
        heals.push(healed);
        // Annotations show up in the HTML report header — a healed run should
        // never look like a clean run.
        testInfo.annotations.push({
          type: 'healed',
          description: `${key} (${healed.source}, ${Math.round(healed.confidence * 100)}%)`,
        });
        if (getConfig().heal.strict) {
          throw new Error(
            `Locator "${key}" required healing and AI_HEAL_STRICT is on.\n` +
              `  was: ${healed.failedWith}\n` +
              `  now: ${JSON.stringify(healed.healedWith)}\n` +
              `  Update the YAML and re-run.`,
          );
        }
      }
      return locator;
    };
    await use(finder);
  },

  ui: async ({ page, find }, use) => {
    await use(new SmartPage(page, find));
  },
});

/**
 * Heal records for the test currently executing in this worker.
 * Playwright runs one test at a time per worker, so a module-level array is
 * safe and lets the `diagnostics` fixture see heals recorded by `find`.
 */
let healsForTest: HealRecord[] = [];

export { expect };
export type { Locator };
export { SmartPage } from './smart-page.js';
export type { Finder } from './smart-page.js';

/** Convenience re-exports so specs need only one import. */
export const describe = test.describe;
export const beforeEach = test.beforeEach;
export const afterEach = test.afterEach;
export const step = test.step;

log.debug('framework fixtures loaded');
