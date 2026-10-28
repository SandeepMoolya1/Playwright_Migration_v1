/**
 * Account Settings — migrated from Selenium `AccountSettings.feature`
 * (step definitions: LoginSteps, AccountSettingsSteps,
 * AccountSettingsNotificationsSteps).
 *
 * One `test` per Examples row, exactly as Cucumber runs them. Titles start
 * with the test case ID and every original tag (feature + scenario + examples
 * level) is preserved, so both of these work:
 *
 *   npx playwright test --grep "DCX-9680"          # by test ID
 *   npx playwright test --grep "@KSP"              # by original tag
 *
 * Each role is authenticated once by its own setup project (`auth-KSP`,
 * `auth-CAMSTHALES`) and the tests reuse that role's storage state, so a
 * role is independent of every other role.
 */
import { test } from '../../src/fixtures/index.js';
import { LoginPage } from '../../src/pages/login.page.js';
import { HomePage } from '../../src/pages/home.page.js';
import { AccountSettingsPage } from '../../src/pages/account-settings.page.js';

type Role = 'KSP' | 'CAMSTHALES';

interface Example {
  id: string;
  role: Role;
  /** Examples-level tags (original Gherkin, verbatim). */
  tags: string[];
  icons?: string;
  settingsOptions?: string;
}

const ALL_ICONS_KSP = 'Search, Service Order Wizard, Language Option, Settings, Notifications';
const ALL_ICONS_CAMS = 'Search, Service Order Wizard, Language Option, Settings';
const KSP_OPTIONS = 'My Profile, Account Settings';
const CAMS_OPTIONS = 'My Profile, Account Settings, Admin Settings';

test.describe('Account Settings', { tag: '@accountSettings' }, () => {
  let login: LoginPage;
  let home: HomePage;
  let settings: AccountSettingsPage;

  // Background: Given User open the Application
  test.beforeEach(async ({ ui, env }) => {
    login = new LoginPage(ui);
    home = new HomePage(ui);
    settings = new AccountSettingsPage(ui);
    await test.step('Given User open the Application', () => login.openApplication(env.startPath!));
  });

  /** When User enter the login Credentials / And click login / And is logged in successfully */
  // Credential entry and the login click run once per role in the auth setup
  // project (tests/auth.setup.ts); the role's storage state is reused here.
  // `_env` is kept so the call sites read like the Gherkin.
  async function signIn(_role: Role, _env?: unknown) {
    await test.step('And User is logged in successfully', () => login.expectLoggedIn());
  }

  const iconsStep = (icons: string) =>
    test.step(`Then User verify following page icons should be visible and interactive on the top section '${icons}'`, () =>
      home.expectIconsVisibleAndInteractive(icons));

  const settingsMenuSteps = async (role: Role, options: string, headingKeyword: 'And' | 'Then' = 'And') => {
    await test.step(`When User clicks on the Settings icon for '${role}'`, () => home.clickSettingsIcon(role));
    await test.step(`Then User verifies the following options should be displayed '${options}'`, () =>
      home.expectSettingsOptionsDisplayed(options));
    await test.step('And User clicks on the account settings option', () => home.clickAccountSettingsOption());
    await test.step(`${headingKeyword} User Verify the Account Settings heading should be visible`, () =>
      settings.expectHeading());
    await test.step('Then User verify that the Notifications side page is displayed by default', () =>
      settings.expectNotificationsByDefault());
  };

  /* ---- Scenario Outline: Verify Settings icon displays the list of options and default page ---- */
  const outline1: Example[] = [
    { id: 'DCX-9680', role: 'KSP', tags: ['@DCX-9680', '@KSP'], icons: ALL_ICONS_KSP },
    { id: 'DCX-10771', role: 'CAMSTHALES', tags: ['@DCX-10771', '@CAMSTHALES'], icons: ALL_ICONS_CAMS },
  ];
  for (const ex of outline1) {
    test(
      `${ex.id}: Verify Settings icon displays the list of options and default page`,
      { tag: ['@accountSettings', '@p0', '@prod', ...ex.tags] },
      async ({ env }) => {
        await signIn(ex.role, env);
        await iconsStep(ex.icons!);
      },
    );
  }

  /* ---- @AS_03: Verify notifications page appears with Notifications header ---- */
  test(
    'DCX-9681: Verify notifications page appears with Notifications header',
    { tag: ['@AS_03', '@accountSettings', '@p0', '@prod', '@DCX-9681', '@KSP'] },
    async ({ env }) => {
      await signIn('KSP', env);
      await iconsStep(ALL_ICONS_KSP);
      await settingsMenuSteps('KSP', KSP_OPTIONS);
    },
  );

  /* ---- @AS_04: Verify Account Settings and menu options for 'KSP' user ---- */
  test(
    "DCX-9682: Verify Account Settings and menu options for 'KSP' user",
    { tag: ['@AS_04', '@accountSettings', '@p0', '@prod', '@DCX-9682', '@KSP'] },
    async ({ env }) => {
      await signIn('KSP', env);
      await iconsStep(ALL_ICONS_KSP);
      await settingsMenuSteps('KSP', KSP_OPTIONS);
      await test.step('Then the following left side menu options should be displayed', () =>
        settings.expectKspMenuDisplayed());
      await test.step('Then User verifies that the Email Preference toggle is turned ON', () =>
        settings.ensureEmailPreferenceToggleOn());
      await test.step('Then User verify the Save Changes button visible at the top and bottom of the account settings page', () =>
        settings.expectSaveChangesTopAndBottomVisible());
    },
  );

  /* ---- @AS_05: Verify Account Settings and menu options for 'CAMSTHALES' user ---- */
  test(
    "DCX-9683: Verify Account Settings and menu options for 'CAMSTHALES' user",
    { tag: ['@AS_05', '@accountSettings', '@p0', '@prod', '@DCX-9683', '@CAMSTHALES'] },
    async ({ env }) => {
      await signIn('CAMSTHALES', env);
      await iconsStep(ALL_ICONS_CAMS);
      await settingsMenuSteps('CAMSTHALES', CAMS_OPTIONS, 'Then');
      await test.step('Then the following left side menu options should be displayed for CAMS User', () =>
        settings.expectCamsMenuDisplayed());
    },
  );

  /* ---- @AS_06: left-side Account Settings options for KSP user ---- */
  test(
    'DCX-9684: Verify visibility and clickability of all left-side Account Settings options for KSP user',
    { tag: ['@AS_06', '@accountSettings', '@p0', '@prod', '@DCX-9684', '@KSP'] },
    async ({ env }) => {
      await signIn('KSP', env);
      await settingsMenuSteps('KSP', KSP_OPTIONS, 'Then');

      await test.step('And User clicks on the Service Preferences option', () => settings.openServicePreferences());
      await test.step('Then User should be redirected to the Service Preferences page', () =>
        settings.expectServicePreferencesPage());
      await test.step('And User clicks on the Account Entitlement option', () => settings.openAccountEntitlement());
      await test.step('Then User should be redirected to the Account Entitlement page', () =>
        settings.expectAccountEntitlementPage());
      await test.step('And User clicks on the Team Management option', () => settings.openTeamManagement());
      await test.step('Then User should be redirected to the Team Management page', () =>
        settings.expectTeamManagementPage());
      await test.step('And User clicks on the Preferred Sites option', () => settings.openPreferredSites());
      await test.step('Then User should be redirected to the Preferred Sites page', () =>
        settings.expectPreferredSitesPage());
      await test.step('And User clicks on the My Files option', () => settings.openMyFiles());
      await test.step('Then User should be redirected to the My Files page', () => settings.expectMyFilesPage());
      await test.step('And User clicks on the Default Address option', () => settings.openDefaultAddress());
      await test.step('Then User should be redirected to the Default Address page', () =>
        settings.expectDefaultAddressPage());
      await test.step('And User clicks on the My Dashboard option', () => settings.openMyDashboard());
      await test.step('Then User should be redirected to the My Dashboard page', () =>
        settings.expectMyDashboardPage());
    },
  );

  /* ---- @AS_07: left-side Account Settings options for CAMSTHALES user ---- */
  test(
    'DCX-9685: visibility and clickability of all left-side Account Settings options for CAMSTHALES user',
    { tag: ['@AS_07', '@accountSettings', '@p0', '@prod', '@DCX-9685', '@CAMSTHALES'] },
    async ({ env }) => {
      await signIn('CAMSTHALES', env);
      await settingsMenuSteps('CAMSTHALES', CAMS_OPTIONS);

      await test.step('And User clicks on the report center option', () => settings.openReportCenter());
      await test.step('Then User should be redirected to the report center page', () =>
        settings.expectReportCenterPage());
      await test.step('And User clicks on the Service Preferences option', () => settings.openServicePreferences());
      await test.step('Then User should be redirected to the Service Preferences page', () =>
        settings.expectServicePreferencesPage());
      await test.step('And User clicks on the Account Entitlement option', () => settings.openAccountEntitlement());
      await test.step('Then User should be redirected to the Account Entitlement page', () =>
        settings.expectAccountEntitlementPage());
      await test.step('And User clicks on the Preferred locations option', () => settings.openPreferredLocations());
      await test.step('Then User should be redirected to the Preferred locations page', () =>
        settings.expectPreferredLocationsPage());
      await test.step('And User clicks on the My Files option', () => settings.openMyFiles());
      await test.step('Then User should be redirected to the My Files page', () => settings.expectMyFilesPage());
      await test.step('And User clicks on the Default Address option', () => settings.openDefaultAddress());
      await test.step('Then User should be redirected to the Default Address page', () =>
        settings.expectDefaultAddressPage());
      await test.step('And User clicks on the My Dashboard option', () => settings.openMyDashboard());
      await test.step('Then User should be redirected to the My Dashboard page', () =>
        settings.expectMyDashboardPage());
    },
  );
});
