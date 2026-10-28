/**
 * Account Settings page. Migrated from Selenium `AccountSettingsPage`,
 * `AccountSettingsSteps` and the toggle step in `AccountSettingsNotificationsPage`.
 *
 * Each `expect*` method keeps the exact comparison the Selenium step used
 * (exact text, contains, case-insensitive, two-part) — none are loosened.
 */
import type { SmartPage } from '../fixtures/smart-page.js';
import { BasePage } from './base.page.js';

const INNER = { useInnerText: true } as const;

const KSP_MENU = [
  'menuNotifications',
  'menuServicePreferences',
  'menuAccountEntitlement',
  'menuTeamManagement',
  'menuPreferredSites',
  'menuMyFiles',
  'menuDefaultAddress',
  'menuMyDashboard',
];

const CAMS_MENU = [
  'menuNotifications',
  'menuReportCenter',
  'menuServicePreferences',
  'menuAccountEntitlement',
  'menuPreferredLocations',
  'menuMyFiles',
  'menuDefaultAddress',
  'menuMyDashboard',
];

export class AccountSettingsPage extends BasePage {
  constructor(ui: SmartPage) {
    super(ui, 'accountSettings');
  }

  /** "User Verify the Account Settings heading should be visible" */
  async expectHeading(): Promise<void> {
    await this.expect('heading').toHaveText('Account Settings', INNER);
  }

  /** "User verify that the Notifications side page is displayed by default" */
  async expectNotificationsByDefault(): Promise<void> {
    await this.expect('notificationsHeader').toHaveText('Notifications', INNER);
  }

  /** "the following left side menu options should be displayed" */
  async expectKspMenuDisplayed(): Promise<void> {
    for (const key of KSP_MENU) await this.expect(key).toBeVisible();
  }

  /** "the following left side menu options should be displayed for CAMS User" */
  async expectCamsMenuDisplayed(): Promise<void> {
    for (const key of CAMS_MENU) await this.expect(key).toBeVisible();
  }

  /**
   * "User verifies that the Email Preference toggle is turned ON".
   *
   * Faithful to Selenium `isToggleOn()`: it carries NO assertion. It reads the
   * wrapper's inline style and, if the style contains "0", clicks the toggle.
   * That behaviour is preserved as-is; see the migration report.
   */
  async ensureEmailPreferenceToggleOn(): Promise<void> {
    const wrapper = await this.locator('emailPreferenceToggleWrapper');
    const style = (await wrapper.getAttribute('style')) ?? '';
    if (style.includes('0')) await this.click('emailPreferenceToggle');
  }

  /** "User verify the Save Changes button visible at the top and bottom ..." */
  async expectSaveChangesTopAndBottomVisible(): Promise<void> {
    await this.expect('saveChangesTop').toBeVisible();
    await this.expect('saveChangesBottom').toBeVisible();
  }

  /* ------------------------------------------------ section navigation */

  async openServicePreferences(): Promise<void> {
    await this.click('menuServicePreferences');
  }
  async expectServicePreferencesPage(): Promise<void> {
    await this.expect('servicePreferencesHeading').toHaveText('Service Preferences', INNER);
  }

  async openAccountEntitlement(): Promise<void> {
    await this.click('menuAccountEntitlement');
  }
  async expectAccountEntitlementPage(): Promise<void> {
    await this.expect('accountEntitlementHeading').toHaveText('Account Entitlements', INNER);
  }

  async openTeamManagement(): Promise<void> {
    await this.click('menuTeamManagement');
  }
  async expectTeamManagementPage(): Promise<void> {
    await this.expect('teamManagementHeading').toHaveText('Team Management', INNER);
  }

  async openPreferredSites(): Promise<void> {
    await this.click('menuPreferredSites');
  }
  async expectPreferredSitesPage(): Promise<void> {
    await this.expect('preferredSitesHeading').toContainText('Preferred Sites', INNER);
  }

  async openMyFiles(): Promise<void> {
    await this.click('menuMyFiles');
  }
  async expectMyFilesPage(): Promise<void> {
    // Selenium: getText().trim().equalsIgnoreCase("My Files")
    await this.expect('myFilesHeading').toHaveText(/^My Files$/i, INNER);
  }

  async openDefaultAddress(): Promise<void> {
    await this.click('menuDefaultAddress');
  }
  async expectDefaultAddressPage(): Promise<void> {
    await this.expect('defaultAddressHeading').toHaveText('Default Address & Contact', INNER);
  }

  async openMyDashboard(): Promise<void> {
    await this.click('menuMyDashboard');
  }
  async expectMyDashboardPage(): Promise<void> {
    await this.expect('myDashboardHeading').toHaveText('My Dashboard', INNER);
  }

  async openReportCenter(): Promise<void> {
    await this.click('menuReportCenter');
  }
  async expectReportCenterPage(): Promise<void> {
    await this.expect('reportCenterHeading').toHaveText('REPORT CENTER', INNER);
  }

  async openPreferredLocations(): Promise<void> {
    await this.click('menuPreferredLocations');
  }
  async expectPreferredLocationsPage(): Promise<void> {
    await this.expect('allLocationsHeading').toHaveText('All Locations', INNER);
    await this.expect('preferredLocationsHeading').toHaveText('Preferred Locations', INNER);
  }
}
