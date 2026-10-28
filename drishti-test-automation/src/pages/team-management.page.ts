/**
 * Account Settings > Team Management. Migrated from Selenium
 * `AccountSettingsTeamManagementPage` (only the steps needed so far).
 *
 * Fixed pauses (`waitFor(n)`) are dropped: actions and assertions auto-wait.
 */
import { expect } from '../fixtures/index.js';
import type { SmartPage } from '../fixtures/smart-page.js';
import { BasePage } from './base.page.js';

export class TeamManagementPage extends BasePage {
  private searchSuggestionCount = 0;

  constructor(ui: SmartPage) {
    super(ui, 'teamManagement');
  }

  private async present(element: string, timeout: number): Promise<boolean> {
    return this.locator(element, { timeout })
      .then((l) => l.isVisible())
      .catch(() => false);
  }

  /** Selenium waits for the toast to show, then to go away. */
  private async awaitToast(): Promise<void> {
    await this.expect('toastMessage').toBeVisible();
    await this.expect('toastMessage').toBeHidden();
  }

  /**
   * Leaves the current team and removes removable members, as Selenium's
   * `clickOnInviteNewMemberBtn()` and `verifyCreateNewTeamButton()` both do first.
   */
  private async clearTeamState(): Promise<void> {
    // Counting is non-waiting (like Selenium), so wait until the team page has rendered one of its states.
    await expect
      .poll(
        async () =>
          (await this.present('leaveTeamButton', 1_000)) ||
          (await this.present('createNewTeamButton', 1_000)) ||
          (await this.present('inviteMember', 1_000)),
        { message: 'Team Management page did not render', timeout: 20_000 },
      )
      .toBe(true);

    if (await this.present('leaveTeamButton', 5_000)) {
      await this.click('leaveTeamButton');
      await this.click('leaveConfirmButton');
      await this.awaitToast();
    }

    // Members render after the page header; keep removing while an enabled Remove button shows up.
    while (await this.present('removeMemberButtons', 3_000)) {
      await this.click('removeMemberButtons');
      if (await this.present('removeMemberConfirmButton', 3_000)) {
        await this.click('removeMemberConfirmButton');
        await this.awaitToast();
      }
    }
  }

  /**
   * Step: "User is not associated with any team and the Create New Team button
   * is displayed". Selenium's `verifyCreateNewTeamButton()` first leaves the
   * team / removes members when present, then reports whether Create New Team
   * is displayed; the step asserts that. Same order here.
   */
  async expectNotInTeamAndCreateNewTeamDisplayed(): Promise<void> {
    await this.clearTeamState();

    await expect(
      this.present('createNewTeamButton', 10_000),
      'Create New Team button is not displayed',
    ).resolves.toBe(true);
  }

  /** Step: "User selects the Create New Team button" (Selenium `clickOnInviteNewMemberBtn()`). */
  async openInviteMembers(): Promise<void> {
    await this.clearTeamState();
    if (await this.present('createNewTeamButton', 5_000)) await this.click('createNewTeamButton');
    else await this.click('inviteMember');
  }

  /** Step: "User enters and selects the email ID from the Type User Emails field". */
  async inviteUserByEmail(email: string): Promise<void> {
    await this.click('typeUsersEmailId');
    await this.fill('typeUsersEmailId', email);
    await (await this.locator('emailSuggestions')).filter({ hasText: email }).first().click();
  }

  /** Step: `User selects the role as "<Role>" for the invited email ID`. */
  async selectInviteRole(role: string): Promise<void> {
    await this.click('roleDropdown');
    const exact = new RegExp(`^\\s*${role.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`);
    await (await this.locator('roleOptions')).filter({ hasText: exact }).first().click();
  }

  /** Step: "User clicks on the Invite button". */
  async clickInvite(): Promise<void> {
    await this.click('inviteButton');
  }

  /** Step: "User verifies the successfully invited toast message '<msg>'". */
  async expectInvitedToast(message: string): Promise<void> {
    await this.expect('toastMessage').toHaveText(message, { useInnerText: true });
  }

  private joinedToast = '';

  /**
   * Step: "User clicks on the Accept Invite button". Like Selenium, it confirms
   * only if a confirmation dialog appears and reads the toast once.
   */
  async acceptInvite(): Promise<void> {
    await this.click('acceptInviteButton');
    if (await this.present('inviteConfirmButton', 2_000)) await this.click('inviteConfirmButton');
    await this.expect('toastMessage').toBeVisible();
    this.joinedToast = await this.textOf('toastMessage');
  }

  /** Step: "User verifies the successfully joined team toast message '<msg>'" (either wording, case-insensitive, as in the source). */
  async expectJoinedToast(message: string): Promise<void> {
    const actual = this.joinedToast.trim().toLowerCase();
    const accepted = [message.trim().toLowerCase(), 'you have successfully joined the team.'];
    expect(accepted.includes(actual), `Expected toast message: [${message}] but found [${this.joinedToast}]`).toBe(true);
  }

  /** Step: "User gets the search suggestion count for entered asset number". */
  async readSearchSuggestionCount(): Promise<void> {
    await this.expect('manageAssets.searchSuggestionCount').toHaveText(/\d+/, { useInnerText: true });
    this.searchSuggestionCount = Number.parseInt(await this.textOf('manageAssets.searchSuggestionCount'), 10);
  }

  /**
   * Step: "User gets the updated row count" -> `verifyRowCount()`, a plain
   * `findElements().size()` that returns 0 for no rows instead of failing.
   */
  async rowCount(): Promise<number> {
    const rows = await this.locator('tableRows', { timeout: 5_000 }).catch(() => null);
    return rows ? rows.count() : 0;
  }
  /** Step: "Verify the counts of assets match in local search and asset grid search". */
  async expectLocalSearchCountMatchesGrid(): Promise<void> {
    const rows = await this.rowCount();
    expect(rows === this.searchSuggestionCount, `grid rows ${rows} vs search suggestions ${this.searchSuggestionCount}`).toBe(true);
  }
}
