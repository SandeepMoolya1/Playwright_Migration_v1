/**
 * My Support Cases page. Migrated from Selenium `MySupportCasesPage`
 * (typeOnSearch, searchResultPresent, clickOnSearchResultCaseNumber,
 * caseHeaderIsPresent, verifySerialNumberDisplayed). Fixed `waitFor` pauses are
 * dropped; assertions retry.
 */
import { expect } from '../fixtures/index.js';
import type { SmartPage } from '../fixtures/smart-page.js';
import { BasePage } from './base.page.js';

export class MySupportCasesPage extends BasePage {
  constructor(ui: SmartPage) {
    super(ui, 'mySupportCases');
  }

  private async resultFor(caseId: string) {
    return (await this.locator('caseSearchResults')).filter({ hasText: caseId }).first();
  }

  /** Step: "User enters Support Case number in the search box and click on search of My support cases page". */
  async searchCase(caseId: string): Promise<void> {
    await (await this.locator('addCommentsOrComments')).waitFor({ state: 'attached' });
    await this.click('searchCaseBox');
    await this.fill('searchCaseBox', caseId);
    await this.click('searchButton');
    await this.click('searchCaseBox');
    await this.press('searchCaseBox', 'Enter');
    await (await this.locator('caseDetailsHeader')).waitFor({ state: 'attached' });
    await expect(await this.resultFor(caseId), 'Search result is not present').toBeVisible();
  }

  /** Step: "User verifies clicks on the search results with case number and opens My Support Case details". */
  async openCaseFromResults(caseId: string): Promise<void> {
    await (await this.resultFor(caseId)).click();
    await expect(await this.resultFor(caseId), 'Search result is not present').toBeVisible();
    await expect(await this.locator('caseNumberHeading'), 'Case header is not present').toContainText(caseId);
  }

  /** Step: "User verifies the stored Serial Number is displayed on the My Support Cases page". */
  async expectSerialNumberDisplayed(expected: string): Promise<void> {
    await expect
      .poll(async () => (await this.textOf('serialNumber')).replace('Serial Number / Host ID:', '').trim(), {
        message: 'Stored Serial Number is not displayed on the My Support Cases page.',
      })
      .toBe(expected);
  }
}
