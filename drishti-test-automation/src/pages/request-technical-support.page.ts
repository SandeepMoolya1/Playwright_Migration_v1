/**
 * Request Technical Support page. Migrated from Selenium
 * `RequestTechnicalSupportPage` / `RequestTechnicalSupportSteps` (and the
 * redirect check from `HomeSteps`). Only the steps needed so far.
 *
 * Fixed pauses (`Thread.sleep(500)`) are dropped: actions and assertions auto-wait.
 */
import { expect } from '../fixtures/index.js';
import type { SmartPage } from '../fixtures/smart-page.js';
import { BasePage } from './base.page.js';

const INNER = { useInnerText: true } as const;

export class RequestTechnicalSupportPage extends BasePage {
  constructor(ui: SmartPage) {
    super(ui, 'requestTechnicalSupport');
  }

  /** Step: "User selects Request Technical Support from the Product Help menu". */
  async selectFromProductHelpMenu(): Promise<void> {
    await this.click('productHelpMenu');
    await this.click('requestTechnicalSupportOption');
  }

  /** Step: "User should be redirected to the Request Technical Support page '<Page Title>'". */
  async expectRedirected(expectedTitle: string): Promise<void> {
    await expect(this.page, 'User is not on the Request Technical Support page!').toHaveTitle(expectedTitle);
  }

  /** Step: "User enters the subject name as '<Subject>' ...". */
  async enterSubject(subject: string): Promise<void> {
    await this.expect('pageHeading').toBeVisible();
    await this.typeUntilKept('subjectInput', subject);
  }

  /** Step: "User enters the description as '<Description>' ...". */
  async enterDescription(description: string): Promise<void> {
    await this.expect('pageHeading').toBeVisible();
    await this.typeUntilKept('descriptionInput', description);
  }

  /**
   * fill() does not enable Submit on this form; Selenium typed real keystrokes
   * (Actions.sendKeys). The form can also re-render and drop typed text
   * (seen for CAMSTHALES), so retry until the value is retained.
   */
  private async typeUntilKept(element: string, value: string): Promise<void> {
    await expect(async () => {
      await this.click(element);
      await this.fill(element, '');
      await this.type(element, value);
      await this.expect(element).toHaveValue(value, { timeout: 3_000 });
    }).toPass({ timeout: 30_000 });
  }

  /** Steps: "Verify that the Submit button is displayed" / "... is clickable". */
  async expectSubmitDisplayed(): Promise<void> {
    await this.expect('submitButton').toBeVisible();
  }

  async expectSubmitClickable(): Promise<void> {
    await this.expect('submitButton').toBeEnabled();
  }

  /** Step: "Verify that the Submit button is disabled". */
  async expectSubmitDisabled(): Promise<void> {
    await this.expect('submitButtonDisabled').toBeDisabled();
  }

  /** Step: "Verify that the Submit button becomes enabled". */
  async expectSubmitEnabled(): Promise<void> {
    await this.expect('submitButton').toBeEnabled();
  }

  /** Step: "User clicks on the submit button on the Request Technical Support page". */
  async clickSubmit(): Promise<void> {
    await this.click('submitButton');
  }

  /**
   * Step: "User verifies the success '<Message>' toast message".
   * Selenium compares the toast title text exactly, then waits for the toast to go away.
   */
  async expectSuccessToast(title: string): Promise<void> {
    await this.expect('toastTitle').toHaveText(title, INNER);
    await this.expect('toastTitle').toBeHidden();
  }

  /** Step: "Verify the successfully created request and my support case page is loaded '<Page Header>'". */
  async expectMySupportCasesPageLoaded(header: string): Promise<void> {
    await this.expect('mySupportCasesHeading').toHaveText(header, INNER);
  }

  /** Step: "Verify that the Generated Answer section is displayed with relevant information for '<subject>'". */
  async expectGeneratedAnswerContains(subject: string): Promise<void> {
    await this.expect('generatedAnswer').toContainText(subject);
  }

  /** Steps: "Verify the Smart Answer toggle is enabled by default" / "... enabled again". */
  async expectSmartAnswerOn(): Promise<void> {
    await this.expect('smartToggleON').toBeVisible();
    await this.expect('smartToggleON').toBeEnabled();
  }

  /** Step: "User toggles the Smart Answer to OFF" (waits until the switch reports OFF, i.e. the ON state is gone). */
  async turnSmartAnswerOff(): Promise<void> {
    await this.click('smartAnswerToggle');
    await this.expect('smartToggleOFF').toBeVisible();
  }

  /** Step: "Verify the Smart Answer toggle is disabled". */
  async expectSmartAnswerOff(): Promise<void> {
    await this.expect('smartToggleOFF').toBeEnabled();
  }

  /** Step: "User toggles the Smart Answer to ON". */
  async turnSmartAnswerOn(): Promise<void> {
    await this.click('smartAnswerToggle');
  }

  /** Step: "User clicks on the Add Product to Case button in the Request Technical Support page". */
  async clickAddProductToCase(): Promise<void> {
    await this.click('addProductCaseBtn');
  }

  /** Step: "User enters product number '<ProductId>' and selects product" (search, then tick the result). */
  async searchAndSelectProduct(productId: string): Promise<void> {
    await this.fill('searchProductInputBox', productId);
    await this.click('productSearchIcon');
    await this.expect('selectProductCheckBox').toBeVisible();
    await this.click('selectProductCheckBox');
  }

  /** Step: "User clicks on the Add Selected Product button". */
  async clickAddSelectedProduct(): Promise<void> {
    await this.click('addSelectedProductsBtn');
  }

  /** Step: "Verify that the selected product '<ProductId>' is added under the Product Information section". */
  async expectProductAdded(productId: string): Promise<void> {
    await this.expect('productInfoProduct').toBeVisible();
    await expect
      .poll(async () => (await this.textOf('productInfoProduct')).replace('Product:', '').trim(), {
        message: `Product ID ${productId} is not displayed under Product Information section.`,
      })
      .toBe(productId);
  }

  /** Step: "User expands the Additional Information section" + "... is expanded and visible". */
  async expandAdditionalInformation(): Promise<void> {
    await this.click('chevronShowAdditionalInfo');
    await this.expect('additionalInfoContent').toBeVisible();
  }

  /** Step: "User fills additional information fields" (Selenium order preserved). */
  async fillAdditionalInformation(d: Record<string, string>): Promise<void> {
    const need = (k: string) => {
      const v = d[k];
      if (v === undefined) throw new Error(`Missing additional information value: ${k}`);
      return v;
    };
    await this.fill('certificateInput', need('Certificate'));
    await this.fill('orderInput', need('Order'));
    await this.selectDropdown('issueTypeDropdown', need('Issue Type'));
    await this.selectDropdown('issueReproducibilityDropdown', need('Issue Reproducibility'));
    await this.fill('currentInput', need('Current'));
    await this.selectDropdown('softwarePlatformDropdown', need('Software Platform'));
    await this.selectDropdown('hardwareSoftwareChangedDropdown', need('Has The Hardware / Software Changed Recently?'));
    await this.selectDropdown('osPlatformDropdown', need('Operating System Platform'));
    await this.fill('fixturesInput', need('Fixtures'));
  }

  private async selectDropdown(element: string, value: string): Promise<void> {
    await this.click(element);
    const option = (await this.locator('dropdownOptions')).filter({ hasText: new RegExp(`^\\s*${escapeRegExp(value)}\\s*$`) });
    await option.last().click();
  }

  /**
   * Step: "User verifies the success '<Message>' toast message and captures the Support Case number".
   * Returns the case number parsed from the toast text, as Selenium's extractCaseNumberFromToast.
   */
  async expectSuccessToastAndCaptureCaseNumber(title: string, header: string): Promise<string> {
    await this.expect('toastTitle').toHaveText(title, INNER);
    const text = await this.textOf('toastDescription');
    const caseNumber = /(?:#\s*|case\s+#?\s*)(\d+)/i.exec(text)?.[1];
    if (!caseNumber) throw new Error('Could not read the Support Case number from the toast');
    await this.expect('mySupportCasesHeading').toHaveText(header, INNER);
    return caseNumber;
  }
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
