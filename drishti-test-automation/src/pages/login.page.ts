/**
 * Keysight Support sign-in. Migrated from Selenium `LoginPage` + `LoginSteps`.
 *
 * Credentials are passed in as a lazily-resolved `UserCredentials`; reading
 * `.username` / `.password` here is the only point they are materialised, and
 * they are only ever sent to the form field — never logged or attached.
 */
import type { UserCredentials } from '../../config/environments.js';
import type { SmartPage } from '../fixtures/smart-page.js';
import { BasePage } from './base.page.js';

export class LoginPage extends BasePage {
  constructor(ui: SmartPage) {
    super(ui, 'login');
  }

  /** Step: "User open the Application" (Background). */
  async openApplication(startPath: string): Promise<void> {
    await this.ui.goto(startPath);
  }

  /** Step: "User enter the login Credentials for '<User>' user". */
  async enterCredentials(credentials: UserCredentials): Promise<void> {
    const { username, password } = credentials;
    await this.click('loginIcon');
    await this.click('usernameInput');
    await this.fill('usernameInput', username);
    await this.fill('passwordInput', password);
  }

  /** Step: "User re login and enter the login Credentials for '<User>' user" (no header login icon; the form is pre-filled with the previous user). */
  async reLoginWithCredentials(credentials: UserCredentials): Promise<void> {
    const { username, password } = credentials;
    await this.click('usernameInput');
    await this.fill('usernameInput', username);
    await this.fill('passwordInput', password);
  }

  /** Step: "User click on the login button". */
  /** Step: "User clicks on the Log Back In button". */
  async clickLogBackIn(): Promise<void> {
    await this.click('logBackInButton');
  }

  async clickLogin(): Promise<void> {
    await this.click('submitButton');
  }

  /**
   * Step: "User is logged in successfully".
   *
   * Source order is preserved: fail fast if no authenticated session appears
   * within 25s, then (as Selenium's verifyLoginPage does) click the header
   * login icon if it is still present, then assert the dashboard heading.
   */
  async expectLoggedIn(): Promise<void> {
    try {
      await this.ui.locator(this.key('sessionIndicator'), { timeout: 25_000 });
    } catch {
      const { origin, pathname } = new URL(this.page.url());
      throw new Error(
        'Login failed - no authenticated session established ' +
          "(none of 'My Dashboard' / 'Other Support Services' / 'Log Out' found). " +
          `Current URL: ${origin}${pathname}`,
      );
    }

    const loginIconPresent = await this.ui
      .locator(this.key('loginIcon'), { timeout: 4_000 })
      .then(() => true)
      .catch(() => false);
    if (loginIconPresent) await this.click('loginIcon');

    await this.expect('dashboardHeading').toHaveText('My Dashboard', { useInnerText: true });
  }
}
