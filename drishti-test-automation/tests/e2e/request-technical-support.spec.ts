/**
 * Request Technical Support - migrated from Selenium
 * `RequestTechnicalSupport.feature` (step definitions: RequestTechnicalSupportSteps,
 * LoginSteps, HomeSteps).
 *
 * Migrated so far: the "Validate Submit creates case ..." outline, both Examples
 * rows: DCX-8554 (KSP) and DCX-9726 (CAMSTHALES), and the Submit-button
 * visibility/enabled outline: DCX-8542 (KSP) and DCX-9718 (CAMSTHALES).
 * The RTS_71 / RTS_73 mandatory-fields outline also covers both roles.
 *
 *   npx playwright test --grep "DCX-8554\b" --project=chromium-KSP
 *   npx playwright test --grep "DCX-9726\b" --project=chromium-CAMSTHALES
 *
 * Only the case-creation tests submit a real support case (Selenium does too;
 * there is no cleanup step in the source). Submit-button checks submit nothing.
 * Login (credentials + login button) runs once per role in its `auth-<role>` setup project.
 */
import { test } from '../../src/fixtures/index.js';
import { LoginPage } from '../../src/pages/login.page.js';
import { RequestTechnicalSupportPage } from '../../src/pages/request-technical-support.page.js';

const SCENARIO_TAGS = ['@RTS_19', '@RTS_54', '@requestTechnicalSupport', '@sanity', '@p0'];

const INPUTS = {
  subject: 'TestDemo',
  description: 'Automation',
  message: 'Support Case Created',
  pageTitle: 'Request Technical Support',
  pageHeader: 'My Support Cases',
} as const;

/** One entry per Examples row of the source scenario outline. */
const examples = [
  { testCaseId: 'DCX-8554', userRole: 'KSP', tags: ['@DCX-8554', '@KSP', '@drishti'], inputs: INPUTS },
  { testCaseId: 'DCX-9726', userRole: 'CAMSTHALES', tags: ['@DCX-9726', '@CAMSTHALES', '@drishti'], inputs: INPUTS },
] as const;

test.describe('RequestTechnicalSupport', { tag: '@RequestTechnicalSupport' }, () => {
  let login: LoginPage;
  let rts: RequestTechnicalSupportPage;

  // Background: Given User open the Application
  test.beforeEach(async ({ ui, env }) => {
    login = new LoginPage(ui);
    rts = new RequestTechnicalSupportPage(ui);
    await test.step('Given User open the Application', () => login.openApplication(env.startPath!));
  });

  for (const { testCaseId, userRole, tags, inputs: d } of examples) {
    test(
      `${testCaseId}: Validate Submit creates case and returns a success message or redirection for '${userRole}'`,
      { tag: [...SCENARIO_TAGS, ...tags] },
      async () => {
        await test.step('Then User is logged in successfully', () => login.expectLoggedIn());
        await test.step('When User selects Request Technical Support from the Product Help menu', () =>
          rts.selectFromProductHelpMenu());
        await test.step(`Then User should be redirected to the Request Technical Support page '${d.pageTitle}'`, () =>
          rts.expectRedirected(d.pageTitle));
        await test.step(`When User enters the subject name as '${d.subject}'`, () => rts.enterSubject(d.subject));
        await test.step(`And User enters the description as '${d.description}'`, () =>
          rts.enterDescription(d.description));
        await test.step('And User clicks on the submit button', () => rts.clickSubmit());
        await test.step(`Then User verifies the success '${d.message}' toast message`, () =>
          rts.expectSuccessToast(d.message));
        await test.step(`Then Verify the successfully created request and my support case page is loaded '${d.pageHeader}'`, () =>
          rts.expectMySupportCasesPageLoaded(d.pageHeader));
      },
    );
  }

  for (const userRole of ['KSP', 'CAMSTHALES'] as const) {
    test(
      `RTS_73: To verify by create a new support case only with mandatory fields for '${userRole}' user`,
      { tag: ['@RTS_71', '@RTS_73', '@requestTechnicalSupport', '@p0', '@sanity', `@${userRole}`, '@drishti', '@mutating'] },
      async ({ env }) => {
        test.skip(env.readOnly, `"${env.name}" is read-only; this test creates a support case`);
        const d = {
          subject: 'Testdemo',
          description: 'Automation',
          pageTitle: 'Request Technical Support',
          message: 'Support Case Created',
        } as const;

        await test.step('And User is logged in successfully', () => login.expectLoggedIn());
        await test.step('When User selects Request Technical Support from the Product Help menu', () =>
          rts.selectFromProductHelpMenu());
        await test.step(`Then User should be redirected to the Request Technical Support page '${d.pageTitle}'`, () =>
          rts.expectRedirected(d.pageTitle));
        await test.step(`When User enters the subject name as '${d.subject}' in Request Technical Support page`, () =>
          rts.enterSubject(d.subject));
        await test.step(`And User enters the description as '${d.description}' in Request Technical Support page`, () =>
          rts.enterDescription(d.description));
        await test.step('And User clicks on the submit button on the Request Technical Support page', () =>
          rts.clickSubmit());
        await test.step(`Then User verifies the success '${d.message}' toast message`, () =>
          rts.expectSuccessToast(d.message));
      },
    );
  }

  /**
   * Outline "Verify the Submit button is present and clickable for '<User>' user"
   * (@RTS_06 @RTS_41 @requestTechnicalSupport @p0 @sanity). Nothing is submitted.
   * Both Examples rows are represented; login is handled by each role's auth project.
   */
  for (const { testCaseId, userRole } of [
    { testCaseId: 'DCX-8542', userRole: 'KSP' },
    { testCaseId: 'DCX-9718', userRole: 'CAMSTHALES' },
  ] as const) {
    test(
    `${testCaseId}: Verify the Submit button is present and clickable for '${userRole}' user`,
    { tag: ['@RTS_06', '@RTS_41', '@requestTechnicalSupport', '@p0', '@sanity', `@${testCaseId}`, `@${userRole}`, '@drishti'] },
    async () => {
      const d = { subject: 'TestDemo', description: 'Automation', pageTitle: 'Request Technical Support' };
      await test.step('Then User is logged in successfully', () => login.expectLoggedIn());
      await test.step('When User selects Request Technical Support from the Product Help menu', () =>
        rts.selectFromProductHelpMenu());
      await test.step(`Then User should be redirected to the Request Technical Support page '${d.pageTitle}'`, () =>
        rts.expectRedirected(d.pageTitle));
      await test.step(`When User enters the subject name as '${d.subject}'`, () => rts.enterSubject(d.subject));
      await test.step(`And User enters the description as '${d.description}'`, () =>
        rts.enterDescription(d.description));
      await test.step('Then Verify that the Submit button is displayed', () => rts.expectSubmitDisplayed());
      await test.step('Then Verify that the Submit button is clickable', () => rts.expectSubmitClickable());
    },
  );
  }

  /**
   * Outline "Validate 'Submit' button becomes active only after mandatory fields are filled"
   * (@RTS_52 @requestTechnicalSupport @p0 @sanity). Only the KSP row (DCX-10775) is migrated;
   * nothing is submitted.
   */
  for (const { testCaseId, userRole } of [{ testCaseId: 'DCX-10775', userRole: 'KSP' }] as const) {
    test(
      `${testCaseId}: Validate 'Submit' button becomes active only after mandatory fields are filled '${userRole}' user`,
      { tag: ['@RTS_52', '@requestTechnicalSupport', '@p0', '@sanity', `@${testCaseId}`, `@${userRole}`, '@drishti'] },
      async () => {
        const d = { subject: 'TestDemo', description: 'Automation', pageTitle: 'Request Technical Support' };
        await test.step('Then User is logged in successfully', () => login.expectLoggedIn());
        await test.step('When User selects Request Technical Support from the Product Help menu', () =>
          rts.selectFromProductHelpMenu());
        await test.step(`Then User should be redirected to the Request Technical Support page '${d.pageTitle}'`, () =>
          rts.expectRedirected(d.pageTitle));
        await test.step('Then Verify that the Submit button is disabled', () => rts.expectSubmitDisabled());
        await test.step(`When User enters the subject name as '${d.subject}' in Request Technical Support page`, () =>
          rts.enterSubject(d.subject));
        await test.step(`And User enters the description as '${d.description}' in Request Technical Support page`, () =>
          rts.enterDescription(d.description));
        await test.step('Then Verify that the Submit button becomes enabled', () => rts.expectSubmitEnabled());
      },
    );
  }

  /**
   * Outline "Verify adding a product to the case via 'Add Product(s) to Case'"
   * (@RTS_23 @RTS_58 @requestTechnicalSupport @p1 @regression). Only the CAMSTHALES row (DCX-9730)
   * is migrated; the KSP row has a blank TestCaseID in the feature and stays out of scope.
   * Nothing is submitted: the product is only added to the unsent case form.
   */
  for (const { testCaseId, userRole, productId } of [
    { testCaseId: 'DCX-9730', userRole: 'CAMSTHALES', productId: 'POG057550' },
  ] as const) {
    test(
      `${testCaseId}: Verify adding a product to the case via 'Add Product(s) to Case' functionality for '${userRole}' user`,
      {
        tag: ['@RTS_23', '@RTS_58', '@requestTechnicalSupport', '@p1', '@regression', `@${testCaseId}`, `@${userRole}`, '@drishti'],
      },
      async () => {
        const d = { subject: 'TestDemo', description: 'Automation', pageTitle: 'Request Technical Support' };
        await test.step('Then User is logged in successfully', () => login.expectLoggedIn());
        await test.step('When User selects Request Technical Support from the Product Help menu', () =>
          rts.selectFromProductHelpMenu());
        await test.step(`Then User should be redirected to the Request Technical Support page '${d.pageTitle}'`, () =>
          rts.expectRedirected(d.pageTitle));
        await test.step(`When User enters the subject name as '${d.subject}' in Request Technical Support page`, () =>
          rts.enterSubject(d.subject));
        await test.step(`And User enters the description as '${d.description}' in Request Technical Support page`, () =>
          rts.enterDescription(d.description));
        await test.step('When User clicks on the Add Product to Case button in the Request Technical Support page', () =>
          rts.clickAddProductToCase());
        await test.step(`And User enters product number '${productId}' and selects product`, () =>
          rts.searchAndSelectProduct(productId));
        await test.step('And User clicks on the Add Selected Product button', () => rts.clickAddSelectedProduct());
        await test.step(`Then Verify that the selected product '${productId}' is added under the Product Information section`, () =>
          rts.expectProductAdded(productId));
      },
    );
  }

  /**
   * DCX-10776 is tagged on two scenarios in the feature: RTS_52 (Submit enabled only after the
   * mandatory fields are filled) and RTS_21/RTS_56 (Smart Answer toggle; also carries @DCX-9728).
   * Both are migrated with their source tags. Nothing is submitted.
   */
  test(
    "DCX-10776: Validate 'Submit' button becomes active only after mandatory fields are filled 'CAMSTHALES' user",
    { tag: ['@RequestTechnicalSupport', '@RTS_52', '@requestTechnicalSupport', '@p0', '@sanity', '@DCX-10776', '@CAMSTHALES', '@drishti'] },
    async () => {
      const d = { subject: 'TestDemo', description: 'Automation', pageTitle: 'Request Technical Support' };
      await test.step('Then User is logged in successfully', () => login.expectLoggedIn());
      await test.step('When User selects Request Technical Support from the Product Help menu', () =>
        rts.selectFromProductHelpMenu());
      await test.step(`Then User should be redirected to the Request Technical Support page '${d.pageTitle}'`, () =>
        rts.expectRedirected(d.pageTitle));
      await test.step('Then Verify that the Submit button is disabled', () => rts.expectSubmitDisabled());
      await test.step(`When User enters the subject name as '${d.subject}' in Request Technical Support page`, () =>
        rts.enterSubject(d.subject));
      await test.step(`And User enters the description as '${d.description}' in Request Technical Support page`, () =>
        rts.enterDescription(d.description));
      await test.step('Then Verify that the Submit button becomes enabled', () => rts.expectSubmitEnabled());
    },
  );

  test(
    "DCX-10776: Validate smart answer toggle can be turned on/off for 'CAMSTHALES' user",
    { tag: ['@RequestTechnicalSupport', '@RTS_21', '@RTS_56', '@requestTechnicalSupport', '@p1', '@regression', '@DCX-9728', '@CAMSTHALES', '@drishti', '@DCX-10776'] },
    async () => {
      const d = { subject: 'What is Jitter', pageTitle: 'Request Technical Support' };
      await test.step('Then User is logged in successfully', () => login.expectLoggedIn());
      await test.step('When User selects Request Technical Support from the Product Help menu', () =>
        rts.selectFromProductHelpMenu());
      await test.step(`Then User should be redirected to the Request Technical Support page '${d.pageTitle}'`, () =>
        rts.expectRedirected(d.pageTitle));
      await test.step(`And User enters the subject name as '${d.subject}' in Request Technical Support page`, () =>
        rts.enterSubject(d.subject));
      await test.step(`Then Verify that the Generated Answer section is displayed with relevant information for '${d.subject}'`, () =>
        rts.expectGeneratedAnswerContains(d.subject));
      await test.step('Then Verify the Smart Answer toggle is enabled by default', () => rts.expectSmartAnswerOn());
      await test.step('When User toggles the Smart Answer to OFF', () => rts.turnSmartAnswerOff());
      await test.step('Then Verify the Smart Answer toggle is disabled', () => rts.expectSmartAnswerOff());
      await test.step('When User toggles the Smart Answer to ON', () => rts.turnSmartAnswerOn());
      await test.step('Then Verify the Smart Answer toggle is enabled again', () => rts.expectSmartAnswerOn());
    },
  );
});
