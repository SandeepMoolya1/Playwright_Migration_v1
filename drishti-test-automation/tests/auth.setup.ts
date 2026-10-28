/**
 * Authentication setup project.
 *
 * Signs in once per role and saves the browser storage state to `.auth/`
 * (gitignored; it holds live session cookies). Browser projects depend on
 * their role's setup and start already authenticated.
 *
 * Lifecycle, per role:
 *   1. delete any previous state file (never reuse a stale/expired session);
 *   2. sign in through the real form and run the same checks as the Selenium
 *      "logged in successfully" step (session present, My Dashboard);
 *   3. only then write the state, to a temp file renamed into place.
 * A failed login leaves no state file, and dependants do not run.
 *
 * In `per-role` environments each role has its own project (`auth-<role>`),
 * so one role's failure never blocks another. Credentials are read lazily
 * from the external file and are never logged; traces are disabled for such
 * environments because they would record the typed values.
 *
 * Environments with no login form definition skip (the local demo has no users).
 */
import fs from 'node:fs';
import path from 'node:path';
import { test as setup } from '../src/fixtures/index.js';
import { LoginPage } from '../src/pages/login.page.js';
import { getEnvironment, storageStatePath } from '../config/environments.js';

const env = getEnvironment();

for (const [role, credentials] of Object.entries(env.users)) {
  setup(`authenticate as ${role}`, async ({ ui, page }) => {
    const statePath = storageStatePath(env.name, role);
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.rmSync(statePath, { force: true });

    const login = new LoginPage(ui);

    await setup.step(`sign in as ${role}`, async () => {
      await login.openApplication(env.startPath ?? '/');
      await login.enterCredentials(credentials);
      await login.clickLogin();
    });

    // Prove the session is real before saving it.
    await setup.step('verify authenticated session', () => login.expectLoggedIn());

    const tmpPath = `${statePath}.tmp`;
    await page.context().storageState({ path: tmpPath });
    fs.renameSync(tmpPath, statePath);
  });
}
