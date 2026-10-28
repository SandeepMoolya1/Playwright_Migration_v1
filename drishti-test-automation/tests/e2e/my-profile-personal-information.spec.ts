/**
 * My Profile > Personal Information - migrated from Selenium
 * `MyProfilePersonalInformation.feature` (step definitions:
 * MyProfilePersonalInformationSteps, LoginSteps, HomePage steps).
 *
 * One `test` per Examples row, exactly as Cucumber runs them. Titles start
 * with the test case ID and every original tag (feature + scenario + examples
 * level) is preserved:
 *
 *   npx playwright test --grep "DCX-9520\b"            # by test ID
 *   npx playwright test --grep "@MyProfilePersonalInformation"
 *
 * Each role is authenticated once by its own setup project (`auth-KSP`,
 * `auth-CAMSTHALES`) and the tests reuse that role's storage state.
 *
 * Scenarios tagged `@notParallel` change the signed-in user's real profile
 * and put it back; they run one at a time per role (serial group), as
 * Selenium's `@notParallel` did.
 */
import { test } from '../../src/fixtures/index.js';
import { LoginPage } from '../../src/pages/login.page.js';
import { HomePage } from '../../src/pages/home.page.js';
import { MyProfilePage } from '../../src/pages/my-profile.page.js';

type Role = 'KSP' | 'CAMSTHALES';

const FEATURE_TAG = '@MyProfilePersonalInformation';
const TOAST = 'Personal Information has been updated successfully';

/** "Verify that the fields in Your Details section have reverted back to default values" */
const YOUR_DETAILS_DEFAULTS = {
  FirstName: 'Shalini',
  LastName: 'Paramantham',
  City: 'Santa Clara',
  State: 'California',
  Country: 'United States',
};

const YOUR_DETAILS_FIELDS = [
  'First (Given) Name',
  'Last (Family) Name',
  'Company Email',
  'Company Name',
  'City',
  'State Or Province',
  'Country',
];

const ADDITIONAL_DETAILS_FIELDS = [
  'Prefix',
  'Job Title',
  'Department',
  'Phone Number',
  'Mobile Number',
  'Fax',
  'Address Line 1',
  'Address Line 2',
  'Address Line 3',
  'Zip Or Postal Code',
];

const YOUR_DETAILS_UPDATE = {
  FirstName: 'TestName',
  LastName: 'TestLast',
  City: 'Bangalore',
  State: 'Karnataka',
  Country: 'India',
};

const ERRORS = ['First Name required', 'Last Name (family) required', 'City required'];

interface Example {
  id: string;
  role: Role;
  /** Scenario-level tags then Examples-level tags, verbatim from the feature. */
  tags: string[];
  notParallel?: boolean;
}

interface AdditionalData {
  Prefix: string;
  JobTitle: string;
  Department: string;
  PhoneNumber: string;
  MobileNumber: string;
  Fax: string;
  AddressLine1: string;
  AddressLine2: string;
  AddressLine3: string;
  PostalCode: string;
}

const ADDITIONAL_DATA: Record<Role, AdditionalData> = {
  CAMSTHALES: {
    Prefix: 'Mr.',
    JobTitle: 'SDETAuto',
    Department: 'QA Automation',
    PhoneNumber: '4081234567',
    MobileNumber: '9876543210',
    Fax: '408987654',
    AddressLine1: '123 Main Street',
    AddressLine2: 'Suite 200',
    AddressLine3: 'Building A',
    PostalCode: '95050',
  },
  KSP: {
    Prefix: 'Ms.',
    JobTitle: 'ET',
    Department: 'QA',
    PhoneNumber: '6505551212',
    MobileNumber: '9123456780',
    Fax: '650555987',
    AddressLine1: '456 Oak Avenue',
    AddressLine2: 'Apt 12B',
    AddressLine3: 'Tower 3',
    PostalCode: '94016',
  },
};

const examples = (
  scenarioTags: string[],
  rows: Array<{ id: string; role: Role; extra: string[] }>,
): Example[] =>
  rows.map(({ id, role, extra }) => ({
    id,
    role,
    tags: [...scenarioTags, `@${id}`, `@${role}`, ...extra],
    notParallel: extra.includes('@notParallel'),
  }));

test.describe('My Profile Personal Information', { tag: FEATURE_TAG }, () => {
  let login: LoginPage;
  let home: HomePage;
  let profile: MyProfilePage;

  // Background: Given User open the Application
  test.beforeEach(async ({ ui, env }) => {
    login = new LoginPage(ui);
    home = new HomePage(ui);
    profile = new MyProfilePage(ui);
    await test.step('Given User open the Application', () => login.openApplication(env.startPath!));
  });

  const s = <T>(title: string, body: () => Promise<T>) => test.step(title, body);

  /**
   * "When User enter the login Credentials / And User click on the login button"
   * run once per role in the auth setup project; only the verification stays here.
   */
  const openMyProfile = async (role: Role) => {
    await s('And User is logged in successfully', () => login.expectLoggedIn());
    await s(`When User clicks on the Settings icon for '${role}'`, () => home.clickSettingsIcon(role));
    await s('And User clicks on the my profile option', () => home.clickMyProfileOption());
    await s('Then Verify that the My Profile page is displayed', () => profile.expectMyProfilePageDisplayed());
  };

  const sectionsDisplayed = () =>
    s('Then Verify Your Details and Additional Details sections are displayed', () => profile.expectTwoSections());
  const clickEditYourDetails = () =>
    s('When User clicks on the Edit Details button in Your Details section', () => profile.clickEditYourDetails());
  const clickSave = () =>
    s('And User clicks on the Save Changes button from Personal Information page', () => profile.clickSaveChanges());
  const randomFirstName = () =>
    s('And User enters a randomly generated first name in first name field', () =>
      profile.enterRandomFirstNameAndSave());
  const toast = (message: string) =>
    s(`Then Verify toast message is displayed on profile page '${message}'`, () =>
      profile.expectToastMessage(message));
  const updateYourDetails = (details: Record<string, string>) =>
    s('And User updates the Your Details information with', () => profile.updateYourDetails(details));
  const verifyYourDetails = (details: Record<string, string>) =>
    s('Then Verify the updated Your Details are displayed as', () => profile.expectYourDetailsDisplayed(details));
  const revertYourDetails = () =>
    s('Then Verify that the fields in Your Details section have reverted back to default values', () =>
      profile.updateYourDetails(YOUR_DETAILS_DEFAULTS));

  /** Registers a Scenario Outline's Examples; @notParallel rows form a serial group per role. */
  const outline = (
    title: string,
    rows: Example[],
    body: (role: Role) => Promise<void>,
  ) => {
    const register = (ex: Example) =>
      test(`${ex.id}: ${title.replace('<User>', ex.role)}`, { tag: ex.tags }, () => body(ex.role));

    rows.filter((r) => !r.notParallel).forEach(register);
    for (const role of ['KSP', 'CAMSTHALES'] as const) {
      const group = rows.filter((r) => r.notParallel && r.role === role);
      if (group.length === 0) continue;
      test.describe(`${role} profile changes (serial)`, () => {
        test.describe.configure({ mode: 'serial' });
        group.forEach(register);
      });
    }
  };

  /* ---- DCX-9520 / DCX-7764 ---- */
  outline(
    'Verify My Profile page displays required sections',
    examples(['@MyProfilePersonalInformation', '@p0', '@sanity', '@prod'], [
      { id: 'DCX-9520', role: 'CAMSTHALES', extra: ['@drishti'] },
      { id: 'DCX-7764', role: 'KSP', extra: ['@drishti'] },
    ]),
    async (role) => {
      await openMyProfile(role);
      await sectionsDisplayed();
    },
  );

  /* ---- DCX-9521 / DCX-7765 ---- */
  outline(
    "Verify My Profile page displays non-editable 'Your Details' section for '<User>' user",
    examples(['@MyProfilePersonalInformation', '@p0', '@sanity'], [
      { id: 'DCX-9521', role: 'CAMSTHALES', extra: ['@drishti', '@notParallel'] },
      { id: 'DCX-7765', role: 'KSP', extra: ['@drishti', '@notParallel'] },
    ]),
    async (role) => {
      await openMyProfile(role);
      await sectionsDisplayed();
      await s('And Verify Your Details section is displayed with fields:', () =>
        profile.expectYourDetailsFields(YOUR_DETAILS_FIELDS));
      await s('And Verify each field in Your Details section is non-editable by default', () =>
        profile.expectYourDetailsFieldsNonEditable());
      await s('Then Verify Edit details button is displayed in Your Details section', () =>
        profile.expectYourDetailsEditButtonPresent());
    },
  );

  /* ---- DCX-9522 / DCX-7766 ---- */
  outline(
    "Verify My Profile page displays non-editable 'Additional Details' section for '<User>' user",
    examples(['@MyProfilePersonalInformation', '@p0', '@sanity'], [
      { id: 'DCX-9522', role: 'CAMSTHALES', extra: ['@drishti', '@notParallel'] },
      { id: 'DCX-7766', role: 'KSP', extra: ['@drishti', '@notParallel'] },
    ]),
    async (role) => {
      await openMyProfile(role);
      await sectionsDisplayed();
      await s('And Verify Additional Details section is displayed with fields:', () =>
        profile.expectAdditionalDetailsFields(ADDITIONAL_DETAILS_FIELDS));
      await s('Then Verify Edit details button is displayed in Additional Details section', () =>
        profile.expectAdditionalDetailsEditButtonPresent());
    },
  );

  /* ---- DCX-9523 / DCX-7767 ---- */
  outline(
    "Verify user is able to edit and save changes to Your Details section for '<User>'",
    examples(['@MyProfilePersonalInformation', '@p0', '@sanity'], [
      { id: 'DCX-9523', role: 'CAMSTHALES', extra: ['@drishti', '@notParallel'] },
      { id: 'DCX-7767', role: 'KSP', extra: ['@drishti', '@notParallel'] },
    ]),
    async (role) => {
      await openMyProfile(role);
      await sectionsDisplayed();
      await randomFirstName();
      await clickEditYourDetails();
      await updateYourDetails(YOUR_DETAILS_UPDATE);
      await clickSave();
      await verifyYourDetails(YOUR_DETAILS_UPDATE);
      await clickEditYourDetails();
      await revertYourDetails();
      await clickSave();
    },
  );

  /* ---- DCX-9528 / DCX-7772 ---- */
  outline(
    'Verify that a user can edit, save, and reset information in the "Your Details" section for \'<User>\'',
    examples(['@MyProfilePersonalInformation', '@p1', '@regression'], [
      { id: 'DCX-9528', role: 'CAMSTHALES', extra: ['@drishti', '@notParallel'] },
      { id: 'DCX-7772', role: 'KSP', extra: ['@drishti', '@notParallel'] },
    ]),
    async (role) => {
      await openMyProfile(role);
      await randomFirstName();
      await sectionsDisplayed();
      await clickEditYourDetails();
      await updateYourDetails(YOUR_DETAILS_UPDATE);
      await clickSave();
      await verifyYourDetails(YOUR_DETAILS_UPDATE);
      await clickEditYourDetails();
      await revertYourDetails();
      await clickSave();
    },
  );

  /* ---- DCX-9525 / DCX-7769 ---- */
  outline(
    "Verify mandatory field validation messages on Personal Information page for '<User>' user",
    examples(['@MyProfilePersonalInformation', '@p0', '@sanity'], [
      { id: 'DCX-9525', role: 'CAMSTHALES', extra: ['@drishti', '@notParallel'] },
      { id: 'DCX-7769', role: 'KSP', extra: ['@drishti', '@notParallel'] },
    ]),
    async (role) => {
      await openMyProfile(role);
      await sectionsDisplayed();
      await clickEditYourDetails();
      await s('And User clearing the text on mandatory fields', () => profile.clearMandatoryFields());
      await s('And User clicks on the Save Changes button from Personal Information page', () =>
        profile.clickSaveChangesIfEnabled());
      await s('Then Verify the error messages on personal information page', () =>
        profile.expectErrorMessages(ERRORS));
    },
  );

  /* ---- DCX-9526 / DCX-7770 ---- */
  outline(
    "Verify CTA buttons are present and Save Button is disabled on My Profile page for '<User>' user",
    examples(['@MyProfilePersonalInformation', '@p0', '@sanity', '@prod'], [
      { id: 'DCX-9526', role: 'CAMSTHALES', extra: ['@drishti', '@notParallel'] },
      { id: 'DCX-7770', role: 'KSP', extra: ['@drishti', '@notParallel'] },
    ]),
    async (role) => {
      await openMyProfile(role);
      await sectionsDisplayed();
      await clickEditYourDetails();
      await s('Then Verify Cancel and Save Changes is present and save changes is disabled', () =>
        profile.expectCancelAndDisabledSave());
    },
  );

  /* ---- DCX-9527 / DCX-7771 ---- */
  outline(
    "Verify toast message is displayed on editing fields for '<User>' user",
    examples(['@MyProfilePersonalInformation', '@p1', '@regression'], [
      { id: 'DCX-9527', role: 'CAMSTHALES', extra: ['@drishti', '@notParallel'] },
      { id: 'DCX-7771', role: 'KSP', extra: ['@drishti', '@notParallel'] },
    ]),
    async (role) => {
      await openMyProfile(role);
      await randomFirstName();
      await sectionsDisplayed();
      await clickEditYourDetails();
      await updateYourDetails(YOUR_DETAILS_UPDATE);
      await clickSave();
      await clickEditYourDetails();
      await revertYourDetails();
      await clickSave();
      await toast(TOAST);
    },
  );

  /* ---- DCX-9524 / DCX-7768 ---- */
  outline(
    'Verify that a user can edit, save, and reset information in the "Additional Details" section for \'<User>\' User',
    examples(['@MyProfilePersonalInformation', '@p0', '@sanity'], [
      { id: 'DCX-9524', role: 'CAMSTHALES', extra: ['@drishti', '@notParallel'] },
      { id: 'DCX-7768', role: 'KSP', extra: ['@drishti', '@notParallel'] },
    ]),
    async (role) => {
      const data = ADDITIONAL_DATA[role];
      await openMyProfile(role);
      await s('And User enters a randomly generated Job Title in job title field', () =>
        profile.enterRandomJobTitleAndPrefixAndSave());
      await toast(TOAST);
      await sectionsDisplayed();
      await s('When User clicks on the Edit Details button in additional details section', () =>
        profile.clickEditAdditionalDetails());
      await s('And User updates the additional details information with', () =>
        profile.updateAdditionalDetails({ ...data }));
      await clickSave();
      await toast(TOAST);
      await s('Then Verify the updated additional details are displayed as', () =>
        profile.expectAdditionalDetailsDisplayed(Object.values(data)));
      await s('When User clicks on the Edit Details button in additional details section', () =>
        profile.clickEditAdditionalDetails());
      await s('Then Verify that the fields in additional details section have reverted back to default values', () =>
        profile.clearAllEditFields());
      await clickSave();
      await toast(TOAST);
    },
  );
});
