/**
 * Migrated from Selenium: AccountSettingsTeamManagement.feature
 *   @TeamManagement
 *   @ASTM_122 @teamManagement @p1 @regression
 *   Scenario Outline: Validate Global and Local Search Result Parity as '<User>' user not part of team
 *   Examples tag: @KSP @notParallel @drishti  (TestCaseID column is empty in the source)
 *
 * Migrated so far: ASTM_122 and ASTM_123 (@mutating: invites and joins a team); other scenarios are pending.
 *
 * User: the Examples row uses the data-column user KSP_User6, which is not a
 * project role. The test therefore signs in as that user itself (`env.extraUsers`)
 * with its own cached session (.auth/<env>-KSP_User6.json, created once by
 * ensureExtraUserState). It never uses, and never waits on, the KSP role's
 * session; run it with --no-deps to skip the KSP auth project entirely.
 */
import fs from 'node:fs';
import { test } from '../../src/fixtures/index.js';
import { ensureExtraUserState } from '../../src/fixtures/extra-user-session.js';
import { getEnvironment, storageStatePath } from '../../config/environments.js';
import { LoginPage } from '../../src/pages/login.page.js';
import { HomePage } from '../../src/pages/home.page.js';
import { AccountSettingsPage } from '../../src/pages/account-settings.page.js';
import { TeamManagementPage } from '../../src/pages/team-management.page.js';
import { ManageAssetsPage } from '../../src/pages/manage-assets.page.js';

// Runs as KSP_User6, never as the KSP role: it reuses that user's own cached
// session (signed in once by `ensureExtraUserState`, not on every run).
const USER = 'KSP_User6';
test.use({ storageState: storageStatePath(getEnvironment().name, USER) });

// @notParallel: the scenario changes team membership / grid preferences of a shared user.
test.describe.configure({ mode: 'serial' });

const testData = {
  testCaseId: 'ASTM_122', // no DCX id exists in the source row
  userRole: 'KSP',
  inputs: {
    user: 'KSP_User6',
    header: 'ASSETS',
    assetNumber: '8447D04023',
    columns: ['ASSET NUMBER'],
  },
};

test.describe('Account Settings Team Management', { tag: '@TeamManagement' }, () => {
  test.beforeAll(async ({ browser, env }) => {
    await ensureExtraUserState(browser, env, USER);
  });

  test(
    `${testData.testCaseId} Validate Global and Local Search Result Parity as '${testData.inputs.user}' user not part of team`,
    { tag: ['@ASTM_122', '@teamManagement', '@p1', '@regression', '@KSP', '@notParallel', '@drishti'] },
    async ({ ui, env }) => {
      const login = new LoginPage(ui);
      const home = new HomePage(ui);
      const settings = new AccountSettingsPage(ui);
      const team = new TeamManagementPage(ui);
      const assets = new ManageAssetsPage(ui);
      const { user, header, assetNumber, columns } = testData.inputs;

      await test.step('Given User open the Application', () => login.openApplication(env.startPath!));

      // Credential entry and the login click ran once in beforeAll; the session is reused.
      await test.step('And User is logged in successfully', () => login.expectLoggedIn());

      await test.step('When User clicks on the Customise Dashboard', () => home.clickCustomiseDashboard());
      await test.step('And User clicks on the Team Management option', () => settings.openTeamManagement());
      await test.step('Then User should be redirected to the Team Management page', () =>
        settings.expectTeamManagementPage());
      await test.step('And User is not associated with any team and the Create New Team button is displayed', () =>
        team.expectNotInTeamAndCreateNewTeamDisplayed());

      await test.step('When User clicks on Manage Assets under Hardware', () => assets.navigateToManageAssets());
      await test.step(`Then Verify Manage Assets page is loaded with '${header}'`, () => assets.expectHeader(header));

      await test.step('When User clicks on the Column Selector button', async () => {
        await assets.openColumnSelector();
        await assets.expectColumnSelectorDisplayed();
      });
      await test.step('And User clears all columns from Visible Columns', () => assets.clearVisibleColumns());
      await test.step("And User moves the column 'Asset Number' to Visible Columns", () =>
        assets.moveAssetNumberToVisible());
      await test.step('And User clicks apply', () => assets.clickApply());
      await test.step(`Then Verify asset table displays only '${columns.join(', ')}'`, () =>
        assets.expectVisibleHeadersEqual(columns));

      await test.step('When User removes the filter pills from the asset grid', () => assets.removeFilterPills());
      await test.step(`And User enters '${assetNumber}' in the asset search field`, () =>
        assets.enterAssetSearch(assetNumber));
      await test.step('And User gets the search suggestion count', () => team.readSearchSuggestionCount());
      await test.step('And User enters the asset number in the search column filter', () =>
        assets.enterAssetNumberColumnFilter(assetNumber));
      await test.step('Then local search and asset grid counts match', async () => {
        await team.rowCount();
        await team.expectLocalSearchCountMatchesGrid();
      });
    },
  );

  test.describe(
    'invited team member',
    () => {
      // ASTM_123 starts as KSP_User4 (team owner) and later signs in as KSP_User6 through the UI.
      test.use({ storageState: storageStatePath(getEnvironment().name, 'KSP_User4') });

      test.beforeAll(async ({ browser, env }) => {
        await ensureExtraUserState(browser, env, 'KSP_User4');
        await ensureExtraUserState(browser, env, 'KSP_User6');
      });

      // The test logs both users out, which ends their server sessions: drop the cached states so the next run signs in again.
      test.afterAll(() => {
        for (const user of ['KSP_User4', 'KSP_User6']) {
          fs.rmSync(storageStatePath(getEnvironment().name, user), { force: true });
        }
      });

      const data = {
        testCaseId: 'ASTM_123',
        user1: 'KSP_User4',
        user2: 'KSP_User6',
        header: 'ASSETS',
        assetNumber: '8447D04023',
        role: 'Member',
        invitedMessage: 'Invite sent to 1 member successfully',
        joinedMessage: 'You have successfully joined a new team',
        columns: ['ASSET NUMBER'],
      };

      test(
        `${data.testCaseId} Validate Global and Local Search Result Parity as '${data.user2}' user as part of team`,
        {
          tag: ['@ASTM_123', '@teamManagement', '@p1', '@regression', '@KSP', '@notParallel', '@drishti', '@mutating'],
        },
        async ({ ui, env }) => {
          const login = new LoginPage(ui);
          const home = new HomePage(ui);
          const settings = new AccountSettingsPage(ui);
          const team = new TeamManagementPage(ui);
          const assets = new ManageAssetsPage(ui);
          const invitee = env.extraUsers?.[data.user2];
          if (!invitee) throw new Error(`Extra user ${data.user2} is not configured for this environment`);
          const { header, assetNumber, role, columns } = data;

          await test.step('Given User open the Application', () => login.openApplication(env.startPath!));
          await test.step(`And User is logged in successfully as '${data.user1}'`, () => login.expectLoggedIn());

          await test.step('When User clicks on the Customise Dashboard', () => home.clickCustomiseDashboard());
          await test.step('And User clicks on the Team Management option', () => settings.openTeamManagement());
          await test.step('Then User should be redirected to the Team Management page', () =>
            settings.expectTeamManagementPage());

          await test.step('When User selects the Create New Team button', () => team.openInviteMembers());
          await test.step('And User enters and selects the email ID from the Type User Emails field', () =>
            team.inviteUserByEmail(invitee.username));
          await test.step(`And User selects the role as "${role}" for the invited email ID`, () =>
            team.selectInviteRole(role));
          await test.step('And User clicks on the Invite button', () => team.clickInvite());
          await test.step(`Then User verifies the successfully invited toast message '${data.invitedMessage}'`, () =>
            team.expectInvitedToast(data.invitedMessage));

          await test.step('When User clicks on the Logout button', () => home.clickLogout());
          await test.step('And User clicks on the Log Back In button', () => login.clickLogBackIn());
          await test.step(`And User logs in as '${data.user2}'`, async () => {
            await login.reLoginWithCredentials(invitee);
            await login.clickLogin();
          });
          await test.step('Then User is logged in successfully', () => login.expectLoggedIn());

          await test.step('When User clicks on the Customise Dashboard', () => home.clickCustomiseDashboard());
          await test.step('And User clicks on the Team Management option', () => settings.openTeamManagement());
          await test.step('Then User should be redirected to the Team Management page', () =>
            settings.expectTeamManagementPage());
          await test.step('When User clicks on the Accept Invite button', () => team.acceptInvite());
          await test.step(`Then User verifies the successfully joined team toast message '${data.joinedMessage}'`, () =>
            team.expectJoinedToast(data.joinedMessage));

          await test.step('When User clicks on Manage Assets under Hardware', () => assets.navigateToManageAssets());
          await test.step(`Then Verify Manage Assets page is loaded with '${header}'`, () =>
            assets.expectHeader(header));
          await test.step('When User clicks on the Column Selector button', async () => {
            await assets.openColumnSelector();
            await assets.expectColumnSelectorDisplayed();
          });
          await test.step('And User clears all columns from Visible Columns', () => assets.clearVisibleColumns());
          await test.step("And User moves the column 'Asset Number' to Visible Columns", () =>
            assets.moveAssetNumberToVisible());
          await test.step('And User clicks apply', () => assets.clickApply());
          await test.step(`Then Verify asset table displays only '${columns.join(', ')}'`, () =>
            assets.expectVisibleHeadersEqual(columns));
          await test.step('When User removes the filter pills from the asset grid', () => assets.removeFilterPills());
          await test.step(`And User enters '${assetNumber}' in the asset search field`, () =>
            assets.enterAssetSearch(assetNumber));
          await test.step('And User gets the search suggestion count', () => team.readSearchSuggestionCount());
          await test.step('And User enters the asset number in the search column filter', () =>
            assets.enterAssetNumberColumnFilter(assetNumber));
          await test.step('Then local search and asset grid counts match', async () => {
            await team.rowCount();
            await team.expectLocalSearchCountMatchesGrid();
          });
        },
      );
    },
  );
});
