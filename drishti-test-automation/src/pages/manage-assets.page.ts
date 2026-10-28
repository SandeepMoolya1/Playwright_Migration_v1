/**
 * Hardware > Manage Assets. Migrated from Selenium `ManageAssetsPage` and the
 * Column Selector / asset-grid methods of `ServiceOrderManagementPage`
 * (only the steps needed so far).
 *
 * Fixed pauses (`waitFor(n)`) are dropped: actions and assertions auto-wait.
 */
import { expect } from '../fixtures/index.js';
import type { SmartPage } from '../fixtures/smart-page.js';
import { BasePage } from './base.page.js';

const INNER = { useInnerText: true } as const;

export class ManageAssetsPage extends BasePage {
  constructor(ui: SmartPage) {
    super(ui, 'manageAssets');
  }

  /** Step: "User clicks on Manage Assets under Hardware". */
  async navigateToManageAssets(): Promise<void> {
    await this.click('hardwareMenu');
    await this.click('manageAssetsOption');
    // Selenium's clickCloseIfenabled(): close an intermittent modal only when it shows up.
    const closer = await this.locator('intermittentCloseButton', { timeout: 3_000 }).catch(() => null);
    if (closer && (await closer.isVisible())) await this.click('intermittentCloseButton');
  }

  /** Step: "Verify Manage Assets page is loaded with '<Header>'". */
  async expectHeader(header: string): Promise<void> {
    await this.expect('pageHeading').toHaveText(header, INNER);
  }

  /** Step: "User clicks on the Column Selector button" (+ popup displayed check). */
  async openColumnSelector(): Promise<void> {
    await this.expect('columnSelectorButton').toBeVisible();
    // The button is visible before its handler is bound (Selenium sleeps ~5s here);
    // retry the click until the dialog actually opens instead of sleeping.
    await expect(async () => {
      await this.click('columnSelectorButton');
      await this.expect('columnSelectorModalTitle', { timeout: 5_000 }).toBeVisible();
    }).toPass({ timeout: 40_000 });
  }

  async expectColumnSelectorDisplayed(): Promise<void> {
    await this.expect('columnSelectorModalTitle').toBeVisible();
  }

  /** Step: "User clears all columns from Visible Columns". */
  async clearVisibleColumns(): Promise<void> {
    const present = await this.locator('visibleColumnOptions', { timeout: 3_000 }).then(() => true, () => false);
    if (!present) return;
    await this.click('visibleColumnOptions');
    await this.press('visibleColumnOptions', 'Control+a');
    await this.click('moveToAvailableButton');
  }

  /** Step: "User moves the column 'Asset Number' to Visible Columns". */
  async moveAssetNumberToVisible(): Promise<void> {
    await this.click('availableColumnAssetNumber');
    await this.click('moveToVisibleButton');
  }

  async clickApply(): Promise<void> {
    await this.applyAndAwaitReload();
  }

  /**
   * Apply saves the column preferences and the application then reloads the whole
   * page a few seconds later (observed on STG: the grid total reads "0 Number of
   * Assets" while it reloads, and filter pills reset). Anything done in that window
   * is lost, so wait for the reload navigation, then for the reloaded grid.
   */
  private async applyAndAwaitReload(): Promise<void> {
    const reloaded = this.page.waitForEvent('framenavigated', {
      predicate: (frame) => frame === this.page.mainFrame(),
      timeout: 30_000,
    });
    await this.click('applyButton');
    await reloaded;
    await this.page.waitForLoadState('load');
    await this.expect('pageHeading').toHaveText('ASSETS', INNER);
    await this.expect('firstAssetCheckbox').toBeVisible();
    await expect(this.page.locator('xpath=//*[@class=\'total\'] | //*[contains(text(),\'Number of\')]').first())
      .toHaveText(/^[1-9]\d* Number of Assets/, { timeout: 60_000 });
  }

  /** Selenium `getVisibleTableHeaders()`: tabulator grid skips its selection column, SLDS does not. */
  async visibleTableHeaders(): Promise<string[]> {
    const tabulator = await this.locator('tabulatorHeaders');
    const useTabulator = (await tabulator.count()) > 0;
    const headers = useTabulator
      ? (await tabulator.allInnerTexts()).slice(1)
      : await (await this.locator('sldsHeaders')).allInnerTexts();
    return headers.map((h) => h.trim()).filter((h) => h !== '');
  }

  /** Step: "Verify the asset table displays the following columns '<columns>'" (strict list equality). */
  async expectVisibleHeadersEqual(expected: string[]): Promise<void> {
    await this.expect('firstAssetCheckbox').toBeVisible();
    await this.click('actionPanelChevron');
    await expect
      .poll(() => this.visibleTableHeaders(), { message: 'asset table headers', timeout: 20_000 })
      .toEqual(expected);
  }

  /**
   * Step: "User removes the filter pills from the asset grid". Selenium returns when
   * there are none, otherwise clicks each pill once and asserts nothing. The default
   * "Active Assets" pill renders after the grid loads (so wait briefly for it) 
   * the click happens only after the post-Apply reload has finished (see applyAndAwaitReload).
   */
  async removeFilterPills(): Promise<void> {
    await this.locator('filterPills', { timeout: 15_000 }).catch(() => undefined);
    const initial = await this.countOf('filterPills');
    for (let i = 0; i < initial; i++) {
      if ((await this.countOf('filterPills')) === 0) break;
      await this.click('filterPills');
    }
  }
  async enterAssetSearch(assetNumber: string): Promise<void> {
    // fill() does not raise the suggestions list; real keystrokes do (as Selenium sendKeys).
    // The grid reloads after the filter pills are removed and can wipe typed text,
    // so retry until the text is kept and the suggestions are shown.
    await expect(async () => {
      await this.click('assetSearchBox');
      await this.fill('assetSearchBox', '');
      await this.type('assetSearchBox', assetNumber);
      await this.expect('assetSearchBox', { timeout: 3_000 }).toHaveValue(assetNumber);
      await this.expect('searchSuggestionCount', { timeout: 8_000 }).toBeVisible();
    }).toPass({ timeout: 60_000 });
  }

  /** Step: "User enters the asset number in the column search filter" (then clicks the total). */
  async enterAssetNumberColumnFilter(assetNumber: string): Promise<void> {
    await this.fill('assetNumberColumnFilter', assetNumber);
    await this.click('totalRecords');
  }
}
