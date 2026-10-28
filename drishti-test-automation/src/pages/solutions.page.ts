/**
 * Solutions Support page. Migrated from Selenium `SolutionsServiceHistoryPage`
 * (`searchAndOpenSolution`) and `SolutionsSupportCasePage`
 * (`verifySupportSectionDisplayed`).
 */
import { expect } from '../fixtures/index.js';
import type { SmartPage } from '../fixtures/smart-page.js';
import { BasePage } from './base.page.js';

export class SolutionsPage extends BasePage {
  constructor(ui: SmartPage) {
    super(ui, 'solutions');
  }

  /** Step: "User searches for solution '<Solution Number>' and opens the solution record". */
  async searchAndOpenSolution(solutionNumber: string): Promise<void> {
    await this.expect('solutionsTree').toBeVisible();
    await this.expect('searchSolutionsInput').toBeVisible();
    await this.expect('searchSolutionsInput').toBeEnabled();
    await this.click('searchSolutionsInput');
    await this.fill('searchSolutionsInput', solutionNumber);

    const record = (await this.locator('solutionNodes')).filter({ hasText: solutionNumber }).first();
    await expect(record, `Solution record is not displayed for: ${solutionNumber}`).toBeVisible();
    await record.click();

    const selected = (await this.locator('selectedSolutionNodes')).filter({ hasText: solutionNumber }).first();
    await expect(selected).toBeVisible();
    await this.expect('serviceHistoryHeader').toBeVisible();
  }

  /** Step: "User verifies Service Support case section displayed". */
  async expectSupportCasesSectionDisplayed(): Promise<void> {
    await (await this.locator('supportCasesHeader')).scrollIntoViewIfNeeded();
    await expect(await this.locator('supportCasesHeader'), 'Support Case header is not displayed').toBeVisible();
  }

  /** Step: "User searches for solution '<n>', clicks the search icon". */
  async searchSolutionWithSearchIcon(solutionNumber: string): Promise<void> {
    await this.expect('solutionsTree').toBeVisible();
    await this.expect('searchSolutionsInput').toBeVisible();
    await this.click('searchSolutionsInput');
    await this.fill('searchSolutionsInput', solutionNumber);
    await this.click('solutionSearchIcon');
  }

  /** Step: "User clicks on the solution record '<n>'". */
  async clickSolutionRecord(solutionNumber: string): Promise<void> {
    const record = (await this.locator('solutionNodes')).filter({ hasText: solutionNumber }).first();
    await expect(record).toBeVisible();
    await record.click();
  }

  /** Step: "User expands the solution hierarchy" (only when children are not already shown). */
  async expandSolutionHierarchyIfCollapsed(): Promise<void> {
    const childrenShown = (await (await this.locator('childSolutionAssets')).count()) > 0;
    if (!childrenShown) await this.click('expandBranchButton');
  }

  /** Step: "User verifies the search box is displayed in the Support Cases section". */
  async expectSupportCasesSearchBoxDisplayed(): Promise<void> {
    await this.expect('supportCaseSearchBox', { timeout: 30_000 }).toBeVisible();
  }

  /** Step: "User verifies the Support Cases table grid is displayed". */
  async expectSupportCaseGridDisplayed(): Promise<void> {
    await this.expect('supportCaseGrid').toBeVisible();
  }

  /** Step: "User verifies the Support Cases table displays the following column headers". */
  async expectColumnHeadersPresent(headers: string[]): Promise<void> {
    const labels = await (await this.locator('supportCaseColumnHeaders')).evaluateAll((els) =>
      els.map((e) => e.getAttribute('aria-label')),
    );
    const missing = headers.filter((h) => !labels.includes(h.trim()));
    expect(missing, `Support Cases table headers not displayed: ${missing.join(', ')}`).toEqual([]);
  }

  /** Selenium `ensureIncludeAllChildAssetCasesToggle`: click only if the state differs, then check it. */
  async setIncludeChildAssetCasesToggle(expectedOn: boolean): Promise<void> {
    const toggle = await this.locator('includeChildAssetCasesToggle');
    const isOn = (await toggle.getAttribute('aria-checked'))?.toLowerCase() === 'true';
    if (isOn !== expectedOn) await toggle.click();
    await expect(
      toggle,
      `Include All Child Asset Cases toggle is not ${expectedOn ? 'enabled' : 'disabled'}.`,
    ).toHaveAttribute('aria-checked', expectedOn ? 'true' : 'false');
  }

  /** Selenium `getDisplayedSupportCaseCount`: digits of the count label. */
  async displayedSupportCaseCount(): Promise<number> {
    const text = await this.textOf('supportCaseCount');
    return Number.parseInt(text.replace(/\D+/g, ''), 10);
  }

  /** Count once the label has stopped changing (the label briefly shows a stale value while the grid loads). */
  async settledSupportCaseCount(): Promise<number> {
    let last = Number.NaN;
    let stable = 0;
    await expect
      .poll(
        async () => {
          const current = await this.displayedSupportCaseCount();
          stable = current === last ? stable + 1 : 0;
          last = current;
          return stable;
        },
        { message: 'Support Case count did not settle', timeout: 30_000, intervals: [500] },
      )
      .toBeGreaterThanOrEqual(3);
    return last;
  }

  /** Waits (retrying) until the displayed count satisfies the comparison; returns the final count. */
  async expectCountToChange(previous: number, direction: 'increase' | 'decrease'): Promise<number> {
    const message = `Support case count did not ${direction}. Previous: ${previous}`;
    await expect
      .poll(() => this.displayedSupportCaseCount(), { message, timeout: 30_000 })
      [direction === 'increase' ? 'toBeGreaterThan' : 'toBeLessThan'](previous);
    return this.displayedSupportCaseCount();
  }

  /** Selenium `verifySupportCaseCountMatchesGridRecords`: sums rows over every page. */
  async countGridRecordsAcrossPages(): Promise<number> {
    let total = 0;
    for (;;) {
      const rows = await this.locator('supportCaseRows');
      total += await rows.count();
      const next = await this.locator('nextPageButton');
      await next.scrollIntoViewIfNeeded();
      if (await next.isDisabled()) break;
      const firstRowBefore = await rows.first().innerText();
      await next.click();
      await expect
        .poll(async () => rows.first().innerText(), { message: 'Support Cases grid did not move to the next page' })
        .not.toBe(firstRowBefore);
    }
    return total;
  }

  /** Selenium `getChildSolutionSupportCaseCounts`: opens each child/grandchild asset and reads its count. */
  async childSupportCaseCounts(): Promise<number[]> {
    const children = await this.locator('childSolutionAssets');
    const total = await children.count();
    expect(total, 'No child solution assets are displayed.').toBeGreaterThan(0);
    const counts: number[] = [];
    let previous = await this.textOf('supportCaseCount');
    for (let i = 0; i < total; i++) {
      await children.nth(i).click();
      await (await this.locator('supportCasesHeader')).scrollIntoViewIfNeeded();
      // Sibling assets can legitimately have equal counts, so a no-change timeout is not a failure.
      await expect.poll(() => this.textOf('supportCaseCount'), { timeout: 15_000 }).not.toBe(previous).catch(() => undefined);
      previous = await this.textOf('supportCaseCount');
      counts.push(await this.displayedSupportCaseCount());
    }
    return counts;
  }

  /** Step: "User clicks on the Request Technical Support button" (Support Cases section). */
  async expectRtsButtonDisplayed(): Promise<void> {
    await this.expect('supportCaseRtsButton').toBeVisible();
  }

  async clickRtsButton(): Promise<void> {
    await this.click('supportCaseRtsButton');
  }

  /** Reads the first case number, then opens it. */
  async openFirstSupportCase(): Promise<string> {
    const first = await this.locator('firstSupportCaseNumber');
    const caseNumber = (await first.innerText()).trim();
    await first.click();
    return caseNumber;
  }

  /** Step: "User verifies the selected solution asset details are pre-filled in the Support Case details page". */
  async expectCaseDetailsNumber(expected: string): Promise<void> {
    await this.expect('caseDetailsCaseNumber').toBeVisible();
    await expect
      .poll(async () => (await this.textOf('caseDetailsCaseNumber')).replace('Case Number:', '').trim(), {
        message: 'Support Case number is not matched.',
      })
      .toBe(expected);
  }

  /** Step: "User searches for '<keyword>' in the Support Cases search box". */
  async searchSupportCases(keyword: string): Promise<void> {
    await this.click('supportCaseSearchInput');
    await this.fill('supportCaseSearchInput', keyword);
    const link = await this.caseNumberLink(keyword);
    await link.waitFor({ state: 'attached' });
    await link.scrollIntoViewIfNeeded();
  }

  private async caseNumberLink(caseNumber: string) {
    return (await this.locator('supportCaseNumberLinks')).filter({ hasText: new RegExp(`^\\s*${caseNumber}\\s*$`) }).first();
  }

  /** Step: "User verifies the Support Cases search functionality filters the results correctly". */
  async supportCaseTableShowsKeyword(keyword: string): Promise<boolean> {
    const grid = await this.locator('supportCaseGrid');
    return (await grid.isVisible()) && (await grid.innerText()).includes(keyword);
  }

  /** Step: "User verifies the support case with the captured case number is displayed in the support case list". */
  async expectCaseInList(caseNumber: string): Promise<void> {
    await this.searchSupportCases(caseNumber);
    await expect(await this.caseNumberLink(caseNumber), `Case '${caseNumber}' is not displayed in the list`).toBeVisible();
  }

  /** Step: "User stores the Serial Number of the selected solution asset". */
  async selectedAssetSerialNumber(): Promise<string> {
    const text = (await this.textOf('selectedAssetSerialNumber')).trim();
    expect(text, 'Serial Number is not displayed.').not.toBe('');
    return text;
  }

  /** Step: "User verifies the Date Opened column displays the date and time in the expected format". */
  async expectDateOpenedFormat(): Promise<void> {
    await this.expect('supportCaseGrid').toBeVisible();
    const cells = await this.locator('dateOpenedValues');
    await expect(cells.first(), 'No Date Opened values are displayed.').toBeVisible();
    const values: string[] = [];
    for (const cell of await cells.all()) if (await cell.isVisible()) values.push((await cell.innerText()).trim());
    expect(values.length, 'No Date Opened values are displayed.').toBeGreaterThan(0);
    const invalid = values.filter((v) => !isValidDateOpened(v));
    expect(invalid, `Date Opened values do not follow d/M/yyyy, HH:mm format: ${invalid}`).toEqual([]);
  }

  /** Step: "User exports the support cases in '<File Type>' format". */
  async exportSupportCases(fileType: string): Promise<void> {
    await this.click('exportButton');
    const option = (await this.locator('exportFormatOptions')).filter({ hasText: new RegExp(`^\\s*${fileType}\\s*$`) }).first();
    await option.click();
  }

  /** Step: "the user verifies the '<toast>' and clicks the My Files button". */
  async expectExportToastAndOpenMyFiles(toastMessage: string): Promise<void> {
    await expect(await this.locator('exportToast'), 'Expected toast message not displayed').toHaveText(toastMessage, {
      useInnerText: true,
    });
    await this.click('toastMyFilesButton');
  }
}

/** Strict d/M/uuuu, HH:mm, as Selenium's STRICT DateTimeFormatter. */
function isValidDateOpened(value: string): boolean {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4}), (\d{2}):(\d{2})$/.exec(value);
  if (!m) return false;
  const [d, mo, y, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d && h < 24 && mi < 60;
}
