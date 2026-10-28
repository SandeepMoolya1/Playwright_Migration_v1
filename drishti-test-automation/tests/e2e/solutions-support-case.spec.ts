/**
 * Solutions Support Case - migrated from Selenium `SolutionSupportCase.feature`
 * (step definitions: LoginSteps, HomeSteps, SolutionsServiceHistorySteps,
 * SolutionsSupportCaseSteps, MySupportCasesSteps, MyFilesSteps,
 * RequestTechnicalSupportSteps).
 *
 * One `test` per Examples row. Every original tag is kept, so both work:
 *
 *   npx playwright test --grep "SLN_SC_01\b" --project=chromium-BMW
 *   npx playwright test --grep "@solutionsSupportCase" --project=chromium-BMW
 *
 * MUTATING (extra tag @mutating, not run until approved):
 *   SLN_SC_09 and SLN_SC_11 create a real support case; SLN_SC_17 exports a report.
 *   Exclude them with:  --grep-invert "@mutating"
 *
 * Login (credentials + login button) runs once per role in the `auth-BMW` setup project.
 */
import { test, expect } from '../../src/fixtures/index.js';
import { LoginPage } from '../../src/pages/login.page.js';
import { HomePage } from '../../src/pages/home.page.js';
import { SolutionsPage } from '../../src/pages/solutions.page.js';
import { MySupportCasesPage } from '../../src/pages/my-support-cases.page.js';
import { MyFilesPage } from '../../src/pages/my-files.page.js';
import { RequestTechnicalSupportPage } from '../../src/pages/request-technical-support.page.js';

const HARDWARE = 'Hardware';
const SOLUTION = 'NX5402B-SS1 Gen-6 Lab 1';
const SOLUTION_WITH_CHILDREN = 'SYS-GM-73T-EZ 83-WA-26/05/2004-179638';
const MENU_CARDS = [{ cardName: 'Solutions', expectedTitle: 'Solutions Support' }] as const;

const COLUMN_HEADERS = [
  'Case Number',
  'Status',
  'Model Number',
  'Serial Number',
  'Subject',
  'Customer Contact Name',
  'Case Type',
  'Date Opened',
  'Date Closed',
];

const ADDITIONAL_INFORMATION: Record<string, string> = {
  Certificate: '12345',
  Order: 'ORD001',
  'Issue Type': 'Defect',
  'Issue Reproducibility': 'Infrequent',
  Current: 'demoV1',
  'Software Platform': 'Laptop',
  'Has The Hardware / Software Changed Recently?': 'Hardware changed',
  'Operating System Platform': 'Windows 11',
  Fixtures: 'Fixtures',
};

const tagsFor = (...tags: string[]) => ['@solutionsSupportCase', ...tags, '@BMW', '@drishti'];

test.describe('Solutions Support Case', { tag: '@solutionsSupportCase' }, () => {
  let login: LoginPage;
  let home: HomePage;
  let solutions: SolutionsPage;
  let mySupportCases: MySupportCasesPage;
  let myFiles: MyFilesPage;
  let rts: RequestTechnicalSupportPage;

  // Background: Given User open the Application
  test.beforeEach(async ({ ui, env }) => {
    login = new LoginPage(ui);
    home = new HomePage(ui);
    solutions = new SolutionsPage(ui);
    mySupportCases = new MySupportCasesPage(ui);
    myFiles = new MyFilesPage(ui);
    rts = new RequestTechnicalSupportPage(ui);
    await test.step('Given User open the Application', () => login.openApplication(env.startPath!));
  });

  const loggedIn = () => test.step('And User is logged in successfully', () => login.expectLoggedIn());

  const openSolutionsMenu = async () => {
    for (const { cardName, expectedTitle } of MENU_CARDS) {
      await test.step(`Then User clicks on the menu options '${HARDWARE}' and verifies the redirected page title '${cardName}' -> '${expectedTitle}'`, () =>
        home.openMenuOptionAndExpectTitle(HARDWARE, cardName, expectedTitle));
    }
  };

  const openSolution = (solution: string) =>
    test.step(`When User searches for solution '${solution}' and opens the solution record`, () =>
      solutions.searchAndOpenSolution(solution));

  const supportSection = () =>
    test.step('Then User verifies Service Support case section displayed', () =>
      solutions.expectSupportCasesSectionDisplayed());

  const searchBox = () =>
    test.step('Then User verifies the search box is displayed in the Support Cases section', () =>
      solutions.expectSupportCasesSearchBoxDisplayed());

  const toggle = (on: boolean) =>
    test.step(`Then User verifies the Include All Child Asset Cases toggle is ${on ? 'ON' : 'OFF'}`, () =>
      solutions.setIncludeChildAssetCasesToggle(on));

  /** Shared opening of every scenario: login check, Solutions menu, open the solution record. */
  const openSolutionRecord = async (solution: string) => {
    await loggedIn();
    await openSolutionsMenu();
    await openSolution(solution);
  };

  /** Shared opening of the scenarios that search with the icon and expand the hierarchy. */
  const openSolutionViaSearchIcon = async (solution: string) => {
    await loggedIn();
    await openSolutionsMenu();
    await test.step(`When User searches for solution '${solution}', clicks the search icon`, () =>
      solutions.searchSolutionWithSearchIcon(solution));
    await test.step('When User expands the solution hierarchy', () => solutions.expandSolutionHierarchyIfCollapsed());
    await test.step(`And User clicks on the solution record '${solution}'`, () => solutions.clickSolutionRecord(solution));
  };

  /** Shared steps of SLN_SC_09 / SLN_SC_11 after the case form is submitted. */
  const verifyCreatedCaseListed = async () => {
    const caseNumber = await test.step("Then User verifies the success 'Support Case Created' toast message and captures the Support Case number", () =>
      rts.expectSuccessToastAndCaptureCaseNumber('Support Case Created', 'My Support Cases'));
    await test.step('And User enters Support Case number in the search box and click on search of My support cases page', () =>
      mySupportCases.searchCase(caseNumber));
    await test.step('Then User verifies clicks on the search results with case number and opens My Support Case details', () =>
      mySupportCases.openCaseFromResults(caseNumber));
    await openSolutionsMenu();
    await openSolution(SOLUTION);
    await supportSection();
    await test.step('And User verifies the support case with the captured case number is displayed in the support case list', () =>
      solutions.expectCaseInList(caseNumber));
  };

  const enterSubjectAndDescription = async () => {
    await test.step('When User clicks on the Request Technical Support button', () => solutions.clickRtsButton());
    await test.step("When User enters the subject name as 'TestDemo' in Request Technical Support page", () =>
      rts.enterSubject('TestDemo'));
    await test.step("And User enters the description as 'Automation' in Request Technical Support page", () =>
      rts.enterDescription('Automation'));
  };

  const submitCase = () =>
    test.step('And User clicks on the submit button on the Request Technical Support page', () => rts.clickSubmit());

  test(
    `SLN_SC_01: Verify that the Service Support Cases section is displayed after opening the selected solution record for 'BMW'`,
    { tag: tagsFor('@p0', '@sanity', '@SLN_SC_01') },
    async () => {
      await openSolutionRecord(SOLUTION);
      await supportSection();
    },
  );

  test(
    `SLN_SC_02: Verify that the Support Cases search box is displayed for the selected solution asset`,
    { tag: tagsFor('@p0', '@sanity', '@SLN_SC_02') },
    async () => {
      await openSolutionRecord(SOLUTION);
      await supportSection();
      await searchBox();
    },
  );

  test(
    `SLN_SC_03: Verify that the Support Cases table is displayed and the displayed Support Case count matches the number of records in the Support Cases grid`,
    { tag: tagsFor('@p1', '@sanity', '@SLN_SC_03', '@SLN_SC_04') },
    async () => {
      await openSolutionRecord(SOLUTION);
      await supportSection();
      await searchBox();
      await toggle(true);
      await test.step('Then User verifies the Support Cases table grid is displayed', () =>
        solutions.expectSupportCaseGridDisplayed());
      const displayed = await test.step('And User stores the displayed Support Case count', () =>
        solutions.displayedSupportCaseCount());
      await test.step('And User verifies the displayed Support Case count matches the number of records in the Support Cases grid', async () => {
        expect(await solutions.countGridRecordsAcrossPages(), 'Support cases grid count mismatch').toBe(displayed);
      });
    },
  );

  test(
    `SLN_SC_05: Verify that the Support Cases table displays all expected column headers for the selected solution asset`,
    { tag: tagsFor('@p1', '@sanity', '@SLN_SC_05') },
    async () => {
      await openSolutionRecord(SOLUTION);
      await supportSection();
      await toggle(true);
      await test.step('Then User verifies the Support Cases table grid is displayed', () =>
        solutions.expectSupportCaseGridDisplayed());
      await test.step('Then User verifies the Support Cases table displays the following column headers', () =>
        solutions.expectColumnHeadersPresent(COLUMN_HEADERS));
    },
  );

  test(
    `SLN_SC_06: Verify that the Request Technical Support button is displayed and redirects the user to the Request Technical Support page`,
    { tag: tagsFor('@p0', '@sanity', '@SLN_SC_06', '@SLN_SC_07') },
    async () => {
      await openSolutionRecord(SOLUTION);
      await supportSection();
      await test.step('Then User verifies the Request Technical Support button is displayed', () =>
        solutions.expectRtsButtonDisplayed());
      await test.step('When User clicks on the Request Technical Support button', () => solutions.clickRtsButton());
      await test.step("Then User should be redirected to the Request Technical Support page 'Request Technical Support'", () =>
        rts.expectRedirected('Request Technical Support'));
    },
  );

  test(
    `SLN_SC_24: Verify that the selected solution asset details are pre-filled when a Support Case is opened from the Support Cases Page`,
    { tag: tagsFor('@p1', '@sanity', '@SLN_SC_24', '@SLN_SC_19') },
    async () => {
      await openSolutionRecord(SOLUTION);
      await supportSection();
      await searchBox();
      await toggle(true);
      await test.step('Then User verifies the Support Cases table grid is displayed', () =>
        solutions.expectSupportCaseGridDisplayed());
      const caseNumber = await test.step('When User clicks on the Support Case number in the Support Cases table', () =>
        solutions.openFirstSupportCase());
      await test.step('Then User verifies the selected solution asset details are pre-filled in the Support Case details page', () =>
        solutions.expectCaseDetailsNumber(caseNumber));
    },
  );

  test(
    `SLN_SC_09: Verify that a support case can be created successfully and is displayed in the selected solution asset's Support Cases list`,
    { tag: tagsFor('@sanity', '@p1', '@mutating', '@SLN_SC_09', '@SLN_SC_10') },
    async () => {
      await openSolutionRecord(SOLUTION);
      await supportSection();
      await searchBox();
      await enterSubjectAndDescription();
      await submitCase();
      await verifyCreatedCaseListed();
    },
  );

  test(
    `SLN_SC_11: Verify that a support case can be created with Additional Information and is displayed in the selected solution asset's Support Cases list`,
    { tag: tagsFor('@sanity', '@mutating', '@SLN_SC_11') },
    async () => {
      await openSolutionRecord(SOLUTION);
      await supportSection();
      await searchBox();
      await enterSubjectAndDescription();
      await test.step('When User expands the Additional Information section', () => rts.expandAdditionalInformation());
      await test.step('When User fills additional information fields', () =>
        rts.fillAdditionalInformation(ADDITIONAL_INFORMATION));
      await submitCase();
      await verifyCreatedCaseListed();
    },
  );

  test(
    `SLN_SC_12: Verify the "Include All Child Asset Cases" Toggle Functionality`,
    { tag: tagsFor('@p1', '@sanity', '@SLN_SC_12') },
    async () => {
      await openSolutionRecord(SOLUTION);
      await supportSection();
      await searchBox();
      await toggle(true);
      await toggle(false);
    },
  );

  test(
    `SLN_SC_13: Verify the Support Cases displayed based on the state of the "Include All Child Asset Cases" toggle`,
    { tag: tagsFor('@p1', '@sanity', '@SLN_SC_13', '@SLN_SC_14') },
    async () => {
      await openSolutionRecord(SOLUTION);
      await supportSection();
      let count = await test.step('And User stores the displayed Support Case count', () =>
        solutions.displayedSupportCaseCount());
      await toggle(true);
      count = await test.step('Then User verifies support cases from the parent, child, and grandchild solution assets are displayed', () =>
        solutions.expectCountToChange(count, 'increase'));
      await toggle(false);
      await test.step('Then User verifies only support cases for the selected parent solution asset are displayed', () =>
        solutions.expectCountToChange(count, 'decrease'));
    },
  );

  test(
    `SLN_SC_15: Verify that enabling the "Include All Child Asset Cases" toggle displays the aggregated support case count for the parent, child, and grandchild solution assets`,
    { tag: tagsFor('@p1', '@sanity', '@SLN_SC_15') },
    async () => {
      await openSolutionViaSearchIcon(SOLUTION_WITH_CHILDREN);
      await supportSection();
      const parentCount = await test.step('Then User stores the displayed Support Case count', () =>
        solutions.settledSupportCaseCount());
      const childCounts = await test.step('And User stores the support case count for each child and grandchild solution asset', () =>
        solutions.childSupportCaseCounts());
      await test.step(`And User clicks on the solution record '${SOLUTION_WITH_CHILDREN}'`, () =>
        solutions.clickSolutionRecord(SOLUTION_WITH_CHILDREN));
      await toggle(true);
      await test.step('Then User verifies the aggregated support case count includes the parent, child, and grandchild solution assets', async () => {
        const expected = parentCount + childCounts.reduce((a, b) => a + b, 0);
        await expect
          .poll(() => solutions.displayedSupportCaseCount(), {
            message:
              'Support Case count after enabling the toggle does not match the parent and child solution case counts.',
          })
          .toBe(expected);
      });
    },
  );

  test(
    `SLN_SC_17: Verify that the user can export Support Cases in 'CSV' format and download the exported file successfully`,
    { tag: tagsFor('@p1', '@sanity', '@mutating', '@SLN_SC_17') },
    async ({}, testInfo) => {
      await openSolutionRecord(SOLUTION_WITH_CHILDREN);
      await supportSection();
      await test.step("And User exports the support cases in 'CSV' format", () => solutions.exportSupportCases('CSV'));
      await test.step('Then the user verifies the toast and clicks the My Files button to navigate to the My Files page', async () => {
        await solutions.expectExportToastAndOpenMyFiles(
          'Please check the My Files section in Account Settings to download Report.',
        );
        await myFiles.expectLoaded();
      });
      const file = await test.step("Then User verifies Case name and 'CSV' Extension in My files", () =>
        myFiles.fileNameAndExtension());
      await test.step('And User downloads the exported file and verifies its name and extension', async () => {
        const download = await myFiles.downloadFirstFile();
        const name = download.suggestedFilename();
        await download.saveAs(testInfo.outputPath(name));
        const extension = file.extension.replace(/^\./, '').toLowerCase();
        expect(name.toLowerCase(), `Downloaded file not found for '${file.name}'`).toContain(file.name.toLowerCase());
        expect(name.toLowerCase().endsWith(`.${extension}`), `Downloaded file extension is not '${extension}'`).toBe(true);
      });
    },
  );

  test(
    `SLN_SC_25: Verify the Support Cases search functionality for 'BMW' user`,
    { tag: tagsFor('@p1', '@sanity', '@SLN_SC_25') },
    async () => {
      const keyword = '02259554';
      await openSolutionRecord(SOLUTION);
      await supportSection();
      await toggle(true);
      await searchBox();
      await test.step(`When User searches for '${keyword}' in the Support Cases search box`, () =>
        solutions.searchSupportCases(keyword));
      await test.step('Then User verifies the Support Cases search functionality filters the results correctly', async () => {
        let shown = await solutions.supportCaseTableShowsKeyword(keyword);
        if (!shown) {
          // Selenium retries once from a clean page.
          await solutions.page.reload();
          await solutions.searchAndOpenSolution(SOLUTION);
          await solutions.expectSupportCasesSectionDisplayed();
          await solutions.setIncludeChildAssetCasesToggle(true);
          await solutions.expectSupportCasesSearchBoxDisplayed();
          await solutions.searchSupportCases(keyword);
          shown = await solutions.supportCaseTableShowsKeyword(keyword);
        }
        expect(shown, `Support Cases table is not displayed with search keyword: ${keyword}`).toBe(true);
      });
    },
  );

  test(
    `SLN_SC_08: Verify the selected solution asset Serial Number is displayed in the Support Case details page for 'BMW' user`,
    { tag: tagsFor('@p1', '@sanity', '@SLN_SC_08') },
    async () => {
      await openSolutionViaSearchIcon(SOLUTION_WITH_CHILDREN);
      const serial = await test.step('And User stores the Serial Number of the selected solution asset', () =>
        solutions.selectedAssetSerialNumber());
      await supportSection();
      await test.step('When User clicks on the Support Case number in the Support Cases table', () =>
        solutions.openFirstSupportCase());
      await test.step('Then User verifies the stored Serial Number is displayed on the My Support Cases page', () =>
        mySupportCases.expectSerialNumberDisplayed(serial));
    },
  );

  test(
    `SLN_SC_23: Verify the date and time format in the Date Opened column for 'BMW' user`,
    { tag: tagsFor('@p0', '@sanity', '@SLN_SC_23') },
    async () => {
      await openSolutionRecord(SOLUTION);
      await supportSection();
      await test.step('And User verifies the Date Opened column displays the date and time in the expected format', () =>
        solutions.expectDateOpenedFormat());
    },
  );
});
