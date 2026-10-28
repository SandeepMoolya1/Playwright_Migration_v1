/**
 * Product Safety & Service Notes - All Service Notes tab. Migrated from Selenium
 * `ProductSafetyAndServiceNotesPage` (+ `totalRecordCount` /
 * `isTotalCountEqualToTableRowCount` of the Preferred Sites page, which the
 * feature reuses). Selenium `waitFor(n)` pauses are replaced by web-first waits.
 */
import { expect } from '../fixtures/index.js';
import type { Download } from '@playwright/test';
import type { SmartPage } from '../fixtures/smart-page.js';
import { BasePage } from './base.page.js';

export class ServiceNotesPage extends BasePage {
  constructor(ui: SmartPage) {
    super(ui, 'serviceNotes');
  }

  /** Step: "User selects Product Safety and Service Notes from the Product Help menu". */
  async openFromProductHelpMenu(): Promise<void> {
    await this.click('requestTechnicalSupport.productHelpMenu');
    await this.click('productSafetyOption');
  }

  /** Step: "User verifies that the Product Safety and Service Notes page is loaded with '<Header>'". */
  async expectLoadedWithHeader(header: string): Promise<void> {
    await this.expect('pageHeader', { timeout: 60_000 }).toHaveText(header, {
      useInnerText: true,
      timeout: 60_000,
    });
  }

  async openAllServiceNotesTab(): Promise<void> {
    // The default tab ("All Sites") first shows "0 Service Notes", then loads its data and
    // resets the selection, which would swallow an early click. Wait for the real count.
    await this.expect('totalRecordCount', { timeout: 60_000 }).toHaveText(/[1-9]/, { useInnerText: true });
    await expect(async () => {
      await this.click('allServiceNotesTab');
      await this.expect('allServiceNotesTab', { timeout: 5_000 }).toHaveAttribute('aria-selected', 'true');
    }).toPass({ timeout: 30_000 });
  }

  /** Steps: "User enters (in)valid product number '<n>' in the search bar". */
  async enterProductNumber(productNumber: string): Promise<void> {
    await this.fill('productSearchBox', productNumber);
  }

  async clickSearchIcon(): Promise<void> {
    await this.click('searchIcon');
  }

  /** Step: "User verifies the '<Error_Msg>' validation message is displayed". */
  async expectNoResultsMessage(message: string): Promise<void> {
    await this.expect('noResultsMessage', { timeout: 30_000 }).toHaveText(message, { useInnerText: true });
  }

  /** Step: "User verifies that the service notes grid displays results for product number". */
  async expectResultsForProductNumber(productNumber: string): Promise<void> {
    const cells = await this.locator('modelNumberCells');
    await expect
      .poll(
        async () => {
          const texts = await cells.evaluateAll(
            (els, wanted) =>
              els
                .filter((e) => e.getAttribute('title') === wanted)
                .map((e) => (e.textContent ?? '').trim()),
            productNumber,
          );
          return texts.length > 0 && texts.every((t) => t.toLowerCase() === productNumber.toLowerCase());
        },
        { message: 'Service notes grid does not display results for the searched product number', timeout: 30_000 },
      )
      .toBe(true);
  }

  async clickFilterButton(): Promise<void> {
    await this.click('filterButton');
  }

  /** Steps: "User selects the (multiple) Service Note Type filter '<t>'" - comma separated list allowed. */
  async selectServiceNoteTypes(types: string): Promise<void> {
    const options = await this.locator('serviceNoteTypeOptions');
    for (const type of types.split(',').map((t) => t.trim())) {
      const option = options.filter({ hasText: new RegExp(`^\\s*${escapeRegExp(type)}\\s*$`) });
      await option.first().scrollIntoViewIfNeeded();
      await option.first().click();
    }
  }

  async clickApply(): Promise<void> {
    await this.click('filterApplyButton');
  }

  async clickClearAll(): Promise<void> {
    await this.click('filterClearAllButton');
  }

  /** Step: "User verifies that only '<types>' service notes are displayed in the grid". */
  async expectOnlyServiceNoteTypes(types: string): Promise<void> {
    const expected = types.split(',').map((t) => t.trim().toLowerCase());
    const cells = await this.locator('serviceNoteTypeCells');
    await expect(cells.first(), 'Service Notes grid shows no rows').toBeVisible({ timeout: 30_000 });
    await expect
      .poll(
        async () => {
          const actual = (await cells.allInnerTexts()).map((t) => t.trim().toLowerCase());
          return actual.length > 0 && actual.every((t) => expected.includes(t));
        },
        { message: `Service Notes grid displays notes other than '${types}'`, timeout: 30_000 },
      )
      .toBe(true);
  }

  /** Step: "User verifies that all applied filters are cleared". */
  async expectAllFiltersCleared(): Promise<void> {
    const boxes = await this.locator('serviceNoteTypeCheckboxes');
    await expect
      .poll(
        () =>
          boxes.evaluateAll((els) =>
            els.filter((e) => e.getAttribute('aria-checked') === 'true' || (e as HTMLInputElement).checked === true)
              .length,
          ),
        { message: 'Service Note Type filters are still selected after clicking Clear All' },
      )
      .toBe(0);
  }

  async enterSerialNumber(serialNumber: string): Promise<void> {
    await this.fill('serialNumberInput', serialNumber);
  }

  /** Step: "User gets the total matching record count in All Service Notes". */
  async totalRecordCount(): Promise<number> {
    await this.expect('totalRecordCount', { timeout: 30_000 }).toHaveText(/\d/, { useInnerText: true });
    const text = await this.textOf('totalRecordCount');
    return Number.parseInt(text.replace(/\D+/g, ''), 10);
  }

  /** Step: "User verifies the total record matches the actual records in the table". */
  async expectTotalMatchesTableRows(total: number): Promise<void> {
    const rows = await this.locator('tableRows');
    await expect(rows, 'Total record count mismatch').toHaveCount(total, { timeout: 30_000 });
  }

  /** Step: "User clicks on the any product number link" - returns the link text and the browser download. */
  async downloadFirstProductNumberLink(): Promise<{ productNumber: string; download: Download }> {
    const link = (await this.locator('productNumberLinks')).first();
    await expect(link, 'No product number links found').toBeVisible({ timeout: 30_000 });
    const productNumber = (await link.innerText()).trim();
    const downloadPromise = this.page.waitForEvent('download', { timeout: 60_000 });
    await link.click();
    return { productNumber, download: await downloadPromise };
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
