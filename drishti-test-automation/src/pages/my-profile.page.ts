/**
 * My Profile > Personal Information page. Migrated from Selenium
 * `MyProfilePersonalInformationPage` and `MyProfilePersonalInformationSteps`.
 *
 * Each `expect*` keeps the exact comparison of the Selenium assert (exact text,
 * ordered list equality, boolean state). Selenium's fixed `waitFor(n)` pauses
 * are dropped: every action and web-first assertion here auto-waits/retries.
 */
import { expect } from '../fixtures/index.js';
import type { SmartPage } from '../fixtures/smart-page.js';
import { BasePage } from './base.page.js';

const INNER = { useInnerText: true } as const;

const YOUR_DETAILS_INPUTS = {
  FirstName: 'firstNameInput',
  LastName: 'lastNameInput',
  City: 'cityInput',
  State: 'stateInput',
} as const;

const YOUR_DETAILS_DISPLAY: Record<string, string> = {
  FirstName: 'yourDetailsFirstName',
  LastName: 'yourDetailsLastName',
  City: 'yourDetailsCity',
  State: 'yourDetailsState',
  Country: 'yourDetailsCountry',
};

const ADDITIONAL_INPUTS: Record<string, string> = {
  Prefix: 'prefixInput',
  JobTitle: 'jobTitleInput',
  Department: 'departmentInput',
  PhoneNumber: 'phoneNumberInput',
  MobileNumber: 'mobileNumberInput',
  Fax: 'faxInput',
  AddressLine1: 'addressLine1Input',
  AddressLine2: 'addressLine2Input',
  AddressLine3: 'addressLine3Input',
  PostalCode: 'zipCodeInput',
};

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const randomLetters = (length: number): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
};

export class MyProfilePage extends BasePage {
  constructor(ui: SmartPage) {
    super(ui, 'myProfile');
  }

  /** "Verify that the My Profile page is displayed" */
  async expectMyProfilePageDisplayed(): Promise<void> {
    await this.expect('heading').toHaveText('My Profile', INNER);
  }

  /** "Verify Your Details and Additional Details sections are displayed" */
  async expectTwoSections(): Promise<void> {
    const sections = await this.locator('sectionHeadings');
    await expect(sections.nth(0), 'First section mismatch').toHaveText('Your Details', INNER);
    await expect(sections.nth(1), 'Second section mismatch').toHaveText('Additional Details', INNER);
  }

  /** "Verify Your Details section is displayed with fields:" (exact, ordered) */
  async expectYourDetailsFields(expected: string[]): Promise<void> {
    await expect(await this.locator('yourDetailsLabels'), 'Mismatch in Your Details section fields').toHaveText(
      expected,
      INNER,
    );
  }

  /** "Verify each field in Your Details section is non-editable by default" */
  async expectYourDetailsFieldsNonEditable(): Promise<void> {
    const fields = await this.locator('yourDetailsValueFields');
    for (const field of await fields.all()) {
      await expect(field, "Some fields in 'Your Details' section are editable!").not.toHaveAttribute(
        'contenteditable',
        /^true$/i,
      );
    }
  }

  /** "Verify Edit details button is displayed in Your Details section" */
  async expectYourDetailsEditButtonPresent(): Promise<void> {
    await this.expect('yourDetailsEditButton').toBeVisible();
  }

  /** "Verify Additional Details section is displayed with fields:" (exact, ordered) */
  async expectAdditionalDetailsFields(expected: string[]): Promise<void> {
    await expect(
      await this.locator('additionalDetailsLabels'),
      'Mismatch in Additional Details section fields',
    ).toHaveText(expected, INNER);
  }

  /** "Verify Edit details button is displayed in Additional Details section" */
  async expectAdditionalDetailsEditButtonPresent(): Promise<void> {
    await this.expect('additionalDetailsEditButton').toBeVisible();
  }

  async clickEditYourDetails(): Promise<void> {
    await this.click('yourDetailsEditButton');
  }

  async clickEditAdditionalDetails(): Promise<void> {
    await this.click('additionalDetailsEditButton');
  }

  /**
   * Save Changes click for the validation scenario. Selenium clicked the inner
   * `<span>` of the button; while the form is invalid the button is disabled and
   * that click is inert, so Selenium moved straight on to the error assertions.
   * Playwright refuses to click a disabled button, so reproduce the same: the
   * button must be visible; it is clicked only if enabled.
   */
  async clickSaveChangesIfEnabled(): Promise<void> {
    const save = await this.locator('saveChangesButton');
    await expect(save, 'Save Changes button is not displayed').toBeVisible();
    if (await save.locator('xpath=ancestor::button[1]').isEnabled()) await save.click();
  }

  async clickSaveChanges(): Promise<void> {
    await this.click('saveChangesButton');
  }

  /** "User updates the Your Details information with" (fixed field order, as Selenium) */
  async updateYourDetails(details: Record<string, string>): Promise<void> {
    for (const [field, key] of Object.entries(YOUR_DETAILS_INPUTS)) {
      if (field in details) await this.fill(key, details[field]!);
    }
    if ('Country' in details) await this.selectCountry(details['Country']!);
  }

  private async selectCountry(country: string): Promise<void> {
    const dropdown = await this.locator('countryDropdown');
    await dropdown.scrollIntoViewIfNeeded();
    await dropdown.click();

    const isNative = (await dropdown.evaluate((el) => el.tagName)) === 'SELECT';
    if (isNative) {
      const labels = await dropdown.getByRole('option').allInnerTexts();
      const label = labels.map((l) => l.trim()).find((l) => l.toLowerCase() === country.toLowerCase());
      if (label === undefined) throw new Error(`Country option not found: ${country}`);
      await dropdown.selectOption({ label });
      return;
    }
    const options = await this.locator('countryPopperOptions');
    await options.filter({ hasText: new RegExp(`^\\s*${escapeRegExp(country)}\\s*$`) }).last().click();
  }

  /** "Verify the updated Your Details are displayed as" */
  async expectYourDetailsDisplayed(details: Record<string, string>): Promise<void> {
    for (const [field, expected] of Object.entries(details)) {
      const key = YOUR_DETAILS_DISPLAY[field];
      if (!key) throw new Error(`No such Your Details field: ${field}`);
      await this.page.evaluate(() => window.scrollTo(0, 0));
      await expect(await this.locator(key), `${field} mismatch!`).toHaveText(expected, INNER);
    }
  }

  /** "User clearing the text on mandatory fields" (First name, Last name, City) */
  async clearMandatoryFields(): Promise<void> {
    for (const key of ['firstNameInput', 'lastNameInput', 'cityInput']) await this.fill(key, '');
  }

  /** "Verify the error messages on personal information page ..." (exact, ordered) */
  async expectErrorMessages(expected: string[]): Promise<void> {
    await expect(await this.locator('errorMessages'), 'Not getting error message').toHaveText(expected, INNER);
  }

  /** "Verify Cancel and Save Changes is present and save changes is disabled" */
  async expectCancelAndDisabledSave(): Promise<void> {
    await expect(await this.locator('cancelButton'), 'Cancel button is not displayed').toBeVisible();
    await expect(await this.locator('saveChangesButton'), 'Save Changes button is not displayed').toBeVisible();
    // Selenium's locator only matches a *disabled* Save Changes button; keep
    // that precondition and also assert the disabled state explicitly.
    const disabledSave = await this.locator('saveChangesButtonDisabled');
    await expect(disabledSave, 'Save changes button is in enable state').toBeVisible();
    await expect(disabledSave.locator('xpath=ancestor::button[1]'), 'Save changes button is in enable state')
      .toBeDisabled();
  }

  /** "Verify toast message is displayed on profile page '<msg>'" */
  async expectToastMessage(message: string): Promise<void> {
    await expect(
      await this.locator('toastMessage'),
      'Toast message not displayed after saving profile changes',
    ).toHaveText(message, INNER);
  }

  /** "User updates the additional details information with" (map iteration order) */
  async updateAdditionalDetails(details: Record<string, string>): Promise<void> {
    for (const [field, value] of Object.entries(details)) {
      const key = ADDITIONAL_INPUTS[field];
      if (!key) continue;
      await this.fill(key, value);
    }
  }

  /** "Verify that the fields in additional details section have reverted back to default values" */
  async clearAllEditFields(): Promise<void> {
    const inputs = await this.locator('editFormInputs');
    for (const input of await inputs.all()) await input.fill('');
  }

  /** "Verify the updated additional details are displayed as" (ordered values) */
  async expectAdditionalDetailsDisplayed(values: string[]): Promise<void> {
    await expect(await this.locator('updatedAdditionalDetails'), 'Updated Additional Details mismatch!').toHaveText(
      values,
      INNER,
    );
  }

  /** "User enters a randomly generated first name in first name field" */
  async enterRandomFirstNameAndSave(): Promise<void> {
    await this.clickEditYourDetails();
    await this.fill('firstNameInput', randomLetters(6));
    await this.clickSaveChanges();
  }

  /** "User enters a randomly generated Job Title in job title field" */
  async enterRandomJobTitleAndPrefixAndSave(): Promise<void> {
    await this.clickEditAdditionalDetails();
    await this.fill('jobTitleInput', randomLetters(6));
    await this.fill('prefixInput', randomLetters(6));
    await this.clickSaveChanges();
  }
}
