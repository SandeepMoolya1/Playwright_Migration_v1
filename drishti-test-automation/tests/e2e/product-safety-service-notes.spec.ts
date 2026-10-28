/**
 * Product Safety and Service Notes - All Service Notes tab. Migrated from
 * Selenium `ProductSafetyAndServiceNotes.feature` (step definitions:
 * LoginSteps, ProductSafetyAndServiceNotesSteps, plus the shared
 * "total record" steps of ProductSafetyAndServiceNotesPreferredSitesSteps).
 *
 * One `test` per Examples row (28), titled with the test case ID, every
 * original tag kept:
 *
 *   npx playwright test --grep "DCX-10954"
 *   npx playwright test --grep "@ProductSafetyServiceNotes" --project=chromium-KSP
 *
 * All scenarios are read-only. Login runs once per role in the auth setup project.
 */
import { test, expect } from '../../src/fixtures/index.js';
import { LoginPage } from '../../src/pages/login.page.js';
import { ServiceNotesPage } from '../../src/pages/service-notes.page.js';

type Role = 'KSP' | 'CAMSTHALES';

interface Example {
  id: string;
  role: Role;
  /** Examples-level tags beyond the test id and role. */
  drishti?: boolean;
  noteType?: string;
  product?: string;
  serial?: string;
  error?: string;
}

const HEADER = 'Service Notes';
const ERROR_MSG = 'No Service Notes found';

const tagsFor = (ex: Example) => [
  '@ProductSafetyServiceNotes',
  '@p0',
  '@sanity',
  `@${ex.id}`,
  `@${ex.role}`,
  ...(ex.drishti === false ? [] : ['@drishti']),
];

test.describe('Product safety and Service Notes - All Service Notes', { tag: '@ProductSafetyServiceNotes' }, () => {
  // Selenium runs maximized; below this width the grid collapses into cards.
  test.use({ viewport: { width: 1920, height: 1080 } });

  let login: LoginPage;
  let notes: ServiceNotesPage;

  // Background: Given User open the Application
  test.beforeEach(async ({ ui, env }) => {
    login = new LoginPage(ui);
    notes = new ServiceNotesPage(ui);
    await test.step('Given User open the Application', () => login.openApplication(env.startPath!));
  });

  /** Login steps run once per role in the auth setup project; the shared opening of every scenario follows. */
  const openAllServiceNotes = async () => {
    await test.step('And User is logged in successfully', () => login.expectLoggedIn());
    await test.step('When User selects Product Safety and Service Notes from the Product Help menu', () =>
      notes.openFromProductHelpMenu());
    await test.step(`Then User verifies that the Product Safety and Service Notes page is loaded with '${HEADER}'`, () =>
      notes.expectLoadedWithHeader(HEADER));
    await test.step('When User clicks on the All Service Notes tab', () => notes.openAllServiceNotesTab());
  };

  const searchProduct = async (product: string) => {
    await test.step(`And User enters valid product number '${product}' in the search bar`, () =>
      notes.enterProductNumber(product));
    await test.step('And User clicks on the Search icon in the search box', () => notes.clickSearchIcon());
  };

  const enterSerial = (serial: string) =>
    test.step(`And User enters the Serial Number '${serial}' in the Serial Number field`, () =>
      notes.enterSerialNumber(serial));

  const applyFilter = async (noteType: string, multiple: boolean) => {
    await test.step('When User clicks on the filter button', () => notes.clickFilterButton());
    await test.step(`When User selects the ${multiple ? 'multiple ' : ''}Service Note Type filter '${noteType}'`, () =>
      notes.selectServiceNoteTypes(noteType));
    await test.step('And User clicks on the Apply button', () => notes.clickApply());
  };

  const expectOnly = (noteType: string) =>
    test.step(`Then User verifies that only '${noteType}' service notes are displayed in the grid`, () =>
      notes.expectOnlyServiceNoteTypes(noteType));

  const expectTotalMatchesTable = async () => {
    const total = await test.step('When User gets the total matching record count in All Service Notes', () =>
      notes.totalRecordCount());
    await test.step('Then User verifies the total record matches the actual records in the table', () =>
      notes.expectTotalMatchesTableRows(total));
  };

  /* 1. invalid product number */
  const invalid: Example[] = [
    { id: 'DCX-10954', role: 'KSP', product: '6986501A', error: ERROR_MSG },
    { id: 'DCX-11057', role: 'CAMSTHALES', product: '6986501A', error: ERROR_MSG },
  ];
  for (const ex of invalid) {
    test(
      `${ex.id}: Verify that no results are displayed when an invalid product number is searched for '${ex.role}' user`,
      { tag: tagsFor(ex) },
      async () => {
        await openAllServiceNotes();
        await test.step(`And User enters invalid product number '${ex.product}' in the search bar`, () =>
          notes.enterProductNumber(ex.product!));
        await test.step('And User clicks on the Search icon in the search box', () => notes.clickSearchIcon());
        await test.step(`Then User verifies the '${ex.error}' validation message is displayed`, () =>
          notes.expectNoResultsMessage(ex.error!));
      },
    );
  }

  /* 2. valid product number */
  const valid: Example[] = [
    { id: 'DCX-10955', role: 'KSP', product: '66101A' },
    { id: 'DCX-11058', role: 'CAMSTHALES', product: '66101A' },
  ];
  for (const ex of valid) {
    test(`${ex.id}: Verify search with valid product number for '${ex.role}' user`, { tag: tagsFor(ex) }, async () => {
      await openAllServiceNotes();
      await searchProduct(ex.product!);
      await test.step(`Then User verifies that the service notes grid displays results for product number '${ex.product}'`, () =>
        notes.expectResultsForProductNumber(ex.product!));
    });
  }

  /* 3. Modification Recommended */
  const recommended: Example[] = [
    { id: 'DCX-10956', role: 'KSP', noteType: 'Modification Recommended' },
    { id: 'DCX-11059', role: 'CAMSTHALES', noteType: 'Modification Recommended' },
  ];
  for (const ex of recommended) {
    test(
      `${ex.id}: Verify that applying the Service Note Type filter displays only 'Modification Recommended' service notes for '${ex.role}' user`,
      { tag: tagsFor(ex) },
      async () => {
        await openAllServiceNotes();
        await applyFilter(ex.noteType!, false);
        await expectOnly(ex.noteType!);
      },
    );
  }

  /* 4. Modification Available (no @drishti in the source) */
  const available: Example[] = [
    { id: 'DCX-10957', role: 'KSP', noteType: 'Modification Available', drishti: false },
    { id: 'DCX-11060', role: 'CAMSTHALES', noteType: 'Modification Available', drishti: false },
  ];
  for (const ex of available) {
    test(
      `${ex.id}: Verify that applying the Service Note Type filter displays only 'Modification Available' service notes for '${ex.role}' user`,
      { tag: tagsFor(ex) },
      async () => {
        await openAllServiceNotes();
        await applyFilter(ex.noteType!, false);
        await expectOnly(ex.noteType!);
      },
    );
  }

  /* 5. Safety / Priority Safety / Information Only */
  const types: Example[] = [
    { id: 'DCX-10958', role: 'KSP', noteType: 'Safety' },
    { id: 'DCX-10959', role: 'KSP', noteType: 'Priority Safety' },
    { id: 'DCX-10960', role: 'KSP', noteType: 'Information Only' },
    { id: 'DCX-11061', role: 'CAMSTHALES', noteType: 'Safety' },
    { id: 'DCX-11062', role: 'CAMSTHALES', noteType: 'Priority Safety' },
    { id: 'DCX-11063', role: 'CAMSTHALES', noteType: 'Information Only' },
  ];
  for (const ex of types) {
    test(
      `${ex.id}: Verify that applying the Service Note Type filter displays only '${ex.noteType}' service notes for '${ex.role}' user`,
      { tag: tagsFor(ex) },
      async () => {
        await openAllServiceNotes();
        await applyFilter(ex.noteType!, false);
        await expectOnly(ex.noteType!);
      },
    );
  }

  /* 6. Clear All */
  const clearAll: Example[] = [
    { id: 'DCX-10961', role: 'KSP', noteType: 'Modification Available,Safety' },
    { id: 'DCX-11064', role: 'CAMSTHALES', noteType: 'Modification Available,Safety' },
  ];
  for (const ex of clearAll) {
    test(
      `${ex.id}: Verify that clicking the Clear All button clears all applied filters and restores the full dataset for '${ex.role}' user`,
      { tag: tagsFor(ex) },
      async () => {
        await openAllServiceNotes();
        await test.step('When User clicks on the filter button', () => notes.clickFilterButton());
        await test.step(`When User selects the multiple Service Note Type filter '${ex.noteType}'`, () =>
          notes.selectServiceNoteTypes(ex.noteType!));
        await test.step('When User clicks on the Clear All button', () => notes.clickClearAll());
        await test.step('Then User verifies that all applied filters are cleared', () => notes.expectAllFiltersCleared());
      },
    );
  }

  /* 7. Serial + product number, record count */
  const serialCount: Example[] = [
    { id: 'DCX-10963', role: 'KSP', product: '66101A', serial: '3444A013' },
    { id: 'DCX-11066', role: 'CAMSTHALES', product: '66101A', serial: '3444A013' },
  ];
  for (const ex of serialCount) {
    test(
      `${ex.id}: Verify that entering both Serial Number and Product Number in the search fields displays matching results for '${ex.role}' user`,
      { tag: tagsFor(ex) },
      async () => {
        await openAllServiceNotes();
        await searchProduct(ex.product!);
        await enterSerial(ex.serial!);
        await expectTotalMatchesTable();
      },
    );
  }

  /* 8. Multiple filters */
  const multi: Example[] = [
    { id: 'DCX-10966', role: 'KSP', noteType: 'Modification Available,Safety' },
    { id: 'DCX-11069', role: 'CAMSTHALES', noteType: 'Modification Available,Safety' },
  ];
  for (const ex of multi) {
    test(
      `${ex.id}: Verify the results match the applied multiple filters for '${ex.role}' user`,
      { tag: tagsFor(ex) },
      async () => {
        await openAllServiceNotes();
        await applyFilter(ex.noteType!, true);
        await expectOnly(ex.noteType!);
      },
    );
  }

  /* 9. Serial + product number + filter */
  const serialFilter: Example[] = [
    { id: 'DCX-10969', role: 'KSP', noteType: 'Modification Recommended', product: '66101A', serial: '3444A013' },
    { id: 'DCX-11072', role: 'CAMSTHALES', noteType: 'Modification Recommended', product: '66101A', serial: '3444A013' },
  ];
  for (const ex of serialFilter) {
    test(
      `${ex.id}: Verify that entering both Serial Number and Product Number in the search fields displays matching results for '${ex.role}' user`,
      { tag: tagsFor(ex) },
      async () => {
        await openAllServiceNotes();
        await searchProduct(ex.product!);
        await enterSerial(ex.serial!);
        await applyFilter(ex.noteType!, false);
        await expectOnly(ex.noteType!);
      },
    );
  }

  /* 10. Product number, record count */
  const productCount: Example[] = [
    { id: 'DCX-10973', role: 'KSP', product: '66101A' },
    { id: 'DCX-11076', role: 'CAMSTHALES', product: '66101A' },
  ];
  for (const ex of productCount) {
    test(
      `${ex.id}: Verify that entering both Serial Number and Product Number in the search fields displays matching results for '${ex.role}' user`,
      { tag: tagsFor(ex) },
      async () => {
        await openAllServiceNotes();
        await searchProduct(ex.product!);
        await expectTotalMatchesTable();
      },
    );
  }

  /* 11. Download */
  const download: Example[] = [
    { id: 'DCX-10972', role: 'KSP', product: '66101A' },
    { id: 'DCX-11075', role: 'CAMSTHALES', product: '66101A' },
  ];
  for (const ex of download) {
    test(
      `${ex.id}: User verifies the downloaded file name contains '${ex.product}' for '${ex.role}' user`,
      { tag: tagsFor(ex) },
      async ({}, testInfo) => {
        await openAllServiceNotes();
        await searchProduct(ex.product!);
        const { productNumber, download: file } = await test.step(
          'And User clicks on the any product number link on the service notes table',
          () => notes.downloadFirstProductNumberLink(),
        );
        await test.step('Then User verifies downloaded file name in the desktop system files', async () => {
          const name = file.suggestedFilename();
          await file.saveAs(testInfo.outputPath(name));
          expect(name, `Downloaded file '${productNumber}.pdf' not found`).toBe(`${productNumber}.pdf`);
        });
      },
    );
  }

  /* 12. Multiple types + product number */
  const multiProduct: Example[] = [
    { id: 'DCX-10968', role: 'KSP', noteType: 'Modification Recommended,Modification Available', product: '66101A' },
    { id: 'DCX-11071', role: 'CAMSTHALES', noteType: 'Modification Recommended,Modification Available', product: '66101A' },
  ];
  for (const ex of multiProduct) {
    test(
      `${ex.id}: Verify filtering of Service Notes by multiple note types and product number for '${ex.role}' user`,
      { tag: tagsFor(ex) },
      async () => {
        await openAllServiceNotes();
        await searchProduct(ex.product!);
        await applyFilter(ex.noteType!, true);
        await expectOnly(ex.noteType!);
      },
    );
  }
});
