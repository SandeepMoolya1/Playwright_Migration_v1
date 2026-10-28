/**
 * Signed-in header and Settings menu. Migrated from Selenium `HomePage`
 * (the account-settings-related methods only).
 */
import type { SmartPage } from '../fixtures/smart-page.js';
import { BasePage } from './base.page.js';

const HEADER_ICONS: Record<string, string> = {
  Search: 'searchIcon',
  'Service Order Wizard': 'serviceOrderWizardIcon',
  'Language Option': 'languageOptionsIcon',
  Settings: 'settingsIcon',
  Notifications: 'notificationsIcon',
};

const SETTINGS_OPTIONS: Record<string, string> = {
  'My Profile': 'myProfileOption',
  'Account Settings': 'accountSettingsOption',
  'Admin Settings': 'adminSettingsOption',
};

const splitList = (list: string): string[] => list.split(',').map((s) => s.trim());

export class HomePage extends BasePage {
  constructor(ui: SmartPage) {
    super(ui, 'home');
  }

  /** Step: "User verify following page icons should be visible and interactive ..." */
  async expectIconsVisibleAndInteractive(icons: string): Promise<void> {
    for (const icon of splitList(icons)) {
      const key = HEADER_ICONS[icon];
      if (!key) throw new Error(`No such icon defined: ${icon}`);
      // Selenium: presence wait, then Assert.assertTrue(isEnabled()).
      await this.expect(key).toBeEnabled();
    }
  }

  /** Step: "User clicks on the Customise Dashboard". */
  async clickCustomiseDashboard(): Promise<void> {
    await this.locator('otherSupportServicesMenu'); // presence wait, as in Selenium
    await this.click('customiseDashboardLink');
  }

  /** Step: "User clicks on the Logout button". */
  async clickLogout(): Promise<void> {
    await this.click('logoutButton');
  }

  /** Step: "User clicks on the Settings icon for '<User>'". */
  async clickSettingsIcon(role: string): Promise<void> {
    if (role === 'KSP') await this.locator('notificationsIcon'); // presence wait, as in Selenium
    await this.click('settingsIcon');
  }

  /** Step: "User verifies the following options should be displayed '<options>'". */
  async expectSettingsOptionsDisplayed(options: string): Promise<void> {
    for (const option of splitList(options)) {
      const key = SETTINGS_OPTIONS[option];
      if (!key) throw new Error(`No such icon defined: ${option}`);
      await this.expect(key).toBeVisible();
      await this.expect(key).toBeEnabled();
    }
  }

  /**
   * Step: "User clicks on the menu options '<Menu>' and verifies the redirected page title"
   * for the Solutions card (Selenium opens the menu with a JS click, then waits for the title).
   * Other cards open in new tabs or navigate back and are not migrated yet.
   */
  async openMenuOptionAndExpectTitle(menu: string, card: string, expectedTitle: string): Promise<void> {
    if (menu !== 'Hardware' || card !== 'Solutions') {
      throw new Error(`Menu option '${card}' under '${menu}' is not migrated yet`);
    }
    await this.click('hardwareMenu');
    await this.click('solutionsMenuOption');
    await this.ui.expectTitle(expectedTitle);
  }

  /** Step: "User clicks on the my profile option". */
  async clickMyProfileOption(): Promise<void> {
    await this.click('myProfileOption');
  }

  /** Step: "User clicks on the account settings option". */
  async clickAccountSettingsOption(): Promise<void> {
    await this.expect('accountSettingsOption').toBeVisible();
    await this.click('accountSettingsOption');
  }
}
