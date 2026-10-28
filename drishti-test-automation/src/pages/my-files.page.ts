/**
 * My Files page. Migrated from Selenium `MyFilesComponent`. The exported report
 * can take a while to appear, so the page is reloaded until the file card shows
 * (Selenium: `waitForDownloadBth`, 6 attempts) - bounded, with web-first waits.
 */
import { expect } from '../fixtures/index.js';
import type { Download } from '@playwright/test';
import type { SmartPage } from '../fixtures/smart-page.js';
import { BasePage } from './base.page.js';

export class MyFilesPage extends BasePage {
  constructor(ui: SmartPage) {
    super(ui, 'myFiles');
  }

  /** Step: "... navigate to the My Files page" - header present. */
  async expectLoaded(): Promise<void> {
    await expect(await this.locator('heading'), 'My files header not present').toBeVisible();
  }

  /** Reloads until the first file card appears (max 6 attempts, as Selenium). */
  async waitForExportedFile(): Promise<void> {
    for (let attempt = 1; attempt <= 6; attempt++) {
      const visible = await this.ui
        .locator(this.key('firstFileName'), { timeout: 10_000 })
        .then((l) => l.isVisible())
        .catch(() => false);
      if (visible) return;
      await this.page.reload();
    }
    await this.expect('firstFileName', { timeout: 10_000 }).toBeVisible();
  }

  /** Step: "User verifies Case name and '<File Type>' Extension in My files" - returns name and extension. */
  async fileNameAndExtension(): Promise<{ name: string; extension: string }> {
    await this.waitForExportedFile();
    return { name: (await this.textOf('firstFileName')).trim(), extension: (await this.textOf('firstFileExtension')).trim() };
  }

  /** Step: "User downloads the exported file" - captures the browser download. */
  async downloadFirstFile(): Promise<Download> {
    const downloadPromise = this.page.waitForEvent('download', { timeout: 60_000 });
    await this.click('firstDownloadButton');
    return downloadPromise;
  }
}
