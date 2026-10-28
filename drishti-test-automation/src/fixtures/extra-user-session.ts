/**
 * Cached sign-in for `env.extraUsers` (data-column users such as KSP_User6).
 *
 * Role users are signed in once by the `auth-<role>` setup project. Extra users
 * have no project, so this does the same job on demand: the first caller signs
 * in through the real form and stores the storage state in
 * `.auth/<env>-<user>.json` (gitignored, never logged); later callers reuse it.
 * A stored state is trusted only after it is proven to still give an
 * authenticated session; otherwise it is deleted and the user signs in again.
 * The file is written to a temp path and renamed, like tests/auth.setup.ts.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Browser, BrowserContextOptions } from '@playwright/test';
import { storageStatePath, type EnvironmentConfig } from '../../config/environments.js';
import { resolveWithHealing } from '../ai/healer.js';
import { SmartPage } from '../fixtures/smart-page.js';
import { getRepository } from '../locators/repository.js';
import { LoginPage } from '../pages/login.page.js';

async function openAs(
  browser: Browser,
  env: EnvironmentConfig,
  contextOptions: BrowserContextOptions,
  title: string,
) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const repo = getRepository();
  const ui = new SmartPage(page, async (key, opts) => {
    const { locator } = await resolveWithHealing({
      page,
      element: repo.get(key),
      timeout: opts?.timeout ?? 30_000,
      testTitle: title,
    });
    return locator;
  });
  const login = new LoginPage(ui);
  await login.openApplication(env.startPath ?? '/');
  return { context, login };
}

/** Ensures a valid storage state exists for the user and returns its path. */
export async function ensureExtraUserState(
  browser: Browser,
  env: EnvironmentConfig,
  userName: string,
  baseOptions: BrowserContextOptions = {},
): Promise<string> {
  const credentials = env.extraUsers?.[userName];
  if (!credentials) throw new Error(`User "${userName}" is not configured in the "${env.name}" environment`);

  const statePath = storageStatePath(env.name, userName);
  fs.mkdirSync(path.dirname(statePath), { recursive: true });

  if (fs.existsSync(statePath)) {
    const { context, login } = await openAs(
      browser,
      env,
      { ...baseOptions, storageState: statePath },
      `reuse session ${userName}`,
    );
    try {
      await login.expectLoggedIn();
      return statePath;
    } catch {
      fs.rmSync(statePath, { force: true }); // expired or invalid: sign in again
    } finally {
      await context.close();
    }
  }

  // Explicitly signed out: browser.newContext inherits the spec's `storageState` option.
  const { context, login } = await openAs(
    browser,
    env,
    { ...baseOptions, storageState: { cookies: [], origins: [] } },
    `sign in ${userName}`,
  );
  try {
    await login.enterCredentials(credentials);
    await login.clickLogin();
    await login.expectLoggedIn();
    const tmpPath = `${statePath}.${process.pid}.tmp`;
    await context.storageState({ path: tmpPath });
    fs.renameSync(tmpPath, statePath);
  } finally {
    await context.close();
  }
  return statePath;
}
