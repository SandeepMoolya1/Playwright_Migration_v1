# Migration playbook

Permanent rules and verified solutions for migrating the Selenium suite to this
framework. Paths, roles and commands: `docs/migration-framework-map.md`.
Status: `docs/migration-tracker.md`.

## Hard rules

1. Selenium repo is read-only. Record `git status --short` before and after.
2. All edits and commits on `develop_Sandeep` only. Never create/switch/delete branches.
3. Default environment is STG (`https://stgsupport.keysight.com/s/?language=en_US`).
   QA is allowed only when the request explicitly says so (`TEST_ENV=qa`).
   Never switch silently, never fall back to another environment, never use
   `prod` without explicit authorization. If the requested environment is
   unavailable, report it; do not claim a pass. Environment selects where tests
   run, not what is migrated; no env-specific edits to locators/data/assertions
   unless a verified difference requires it.
4. Credentials only via `CREDS_FILE_PATH` (external file). Never hardcode, copy,
   print, or log values; print key names only. Never put secrets in test data.
5. Never weaken or drop assertions, IDs or tags. Never use `waitForTimeout`.
6. No selectors in specs; all in `locators/*.yml`.
7. Preserve unrelated user changes; no destructive git.
8. Migrate only the requested scope.

## Drafts and settings

- Step-by-step procedure: `.claude/skills/aiqa-ksp-migration/SKILL.md` (binding).
- Every remaining scenario is a `test.fixme` draft in `tests/drafts/`
  (`npm run migrate:drafts`; source from `SELENIUM_PROJECT_PATH`; work list
  `docs/migration-drafts-report.md`). Graduate drafts into `tests/e2e/`; never
  un-fixme or hand-edit them.
- Local settings live in `.env` (gitignored; template `.env.example`):
  `TEST_ENV`, `AI_HEAL`, `CREDENTIALS_FILE`, ... Shell variables override it;
  `KEY=` (empty) means unset. `TEST_ENV` in `.env` is honoured.
- A role-tagged test (`@KSP`, `@CAMSTHALES`, `@BMW`) only runs where that role
  exists: per-role environments select it by tag; others (e.g. `local`)
  exclude it via `grepInvert` in `playwright.config.ts` instead of failing.
- `tests/e2e/healing.spec.ts` skips its two heal-dependent tests when
  `AI_HEAL=off` (the `.env` default for STG work); run them with `AI_HEAL=on`.

## Workflow

1. Resolve request (module / DCX IDs / tag) to `.feature` files under
   `src\test\java\scenarios\features`.
2. Read the tracker and map; skip analysis already recorded.
3. Read feature, step definitions, page objects, `Hooks.java`, test data, role mapping.
4. Map each scenario and Outline example row to one Playwright test.
5. Add locators (XPath from Selenium kept as primary), page object, spec.
6. `npx tsc --noEmit`, `--list`, tag/ID comparison against the feature.
7. Run against STG with `AI_HEAL=off`. Mutating tests need user approval first.
8. Diagnose failures, fix automation defects, update tracker and playbook.

## Conventions

- Spec per feature: `tests/e2e/<kebab-feature>.spec.ts`; import `test, expect`
  from `src/fixtures/index.js`; feature tag on `test.describe`; scenario tags in
  `{ tag: [...] }`. Include the role tag (needed by project grep) and DCX ID in
  the title.
- Test data: typed inline constants beside the test, e.g.
  `{ testCaseId, userRole, inputs }`. No passwords.
- `@notParallel` -> per-role `test.describe.configure({ mode: 'serial' })`.
- Login steps run once in `auth-<ROLE>`; each test still asserts
  `login.expectLoggedIn()`.
- Auth is per role; a role's tests depend only on its own setup project.

## Verified solutions

- Selenium `getText()` -> `ui.expect(key).toHaveText(x, { useInnerText: true })`.
- Click on disabled Save is inert in Selenium; Playwright refuses. Use
  `clickSaveChangesIfEnabled` (my-profile page) and still assert state.
- Disabled-state check: assert button visible and `toBeDisabled` on ancestor.
- Dynamic Radix popper country option: located by text within the popper list.
- Fixed 2-3s pauses replaced by auto-wait / web-first assertions.
- Salesforce/React inputs that ignore `fill()` (Submit stays disabled): click, then `ui.type` (real keystrokes), as Selenium's `Actions.sendKeys` did. The form may also re-render and drop typed text (seen once for CAMSTHALES on DCX-9726): wrap click/clear/type/`toHaveValue` in `expect(...).toPass()` (`typeUntilKept` in the RTS page object). Verified for DCX-8554 and DCX-9726.
- Selenium toast check (`getText` equals title, then wait invisible) -> `toHaveText(..., useInnerText)` then `toBeHidden()`.
- Secret scan: programmatically grep `test-results`, `playwright-report`, `.ai`,
  `.auth` for password values without printing them.

## Selenium quirks

- `isToggleOn()` has no assertion and may click (DCX-9682).
- "Reverted to default" steps are actions, not assertions.
- `NON_Entitle_User` password read via `KSP_Password`.
- Many tests tagged `@KSP` actually use data-column users (`KSP_User1..`).
- RTS_71/RTS_73 share one outline with blank DCX IDs and two role rows.
  Preserve both tags and use a role-specific RTS title rather than inventing
  DCX IDs. Source subject is `Testdemo` (not the older draft's `TestDemo`).
  Both rows passed on STG with healing off on 2026-10-26; each submits one case.

## Draft regeneration checks

- Empty Examples IDs must fall back to the scenario's ID tag; otherwise
  graduated RTS outlines remain duplicated as drafts.
- Curated namespace aliases must not take another Java page class's natural
  namespace. The newer source contains both SolutionsPage and
  SolutionsServiceHistoryPage; they need distinct generated outputs.
- Emit method-result assertions only when the expected value is a supported
  literal or bound argument. Java expressions such as
  `context.scenarioContext.getContext(...)` stay explicit TODOs, not invalid
  TypeScript. These guards were verified by regenerating the newer source and
  passing `tsc --noEmit`; drafts remain `test.fixme`.

## Failure classification

Automation defect / application defect / environment-connectivity /
credential-permission / test-data-setup / inconclusive. State evidence; no empty
catches, forced passes or blanket retries.

## Corrections to the original brief

- `PW_CREDS_FILE` and `playwright.creds.properties` do not exist; actual is `CREDS_FILE_PATH`.
- Product Life Cycle and My Account Agreements were not yet migrated at bootstrap.
- No `migration_playwright` branch is used; work is on `develop_Sandeep`.

- ASTM_123 (invite + re-login as a second user): Selenium locators can be stale or match hidden duplicates. Team Management's enabled Remove buttons are `button[aria-label^='Remove Member']` (no `data-variant=hyperlink`) and removal has no confirm dialog; `inviteMember` / `logoutButton` match a hidden layout first, so use `filter: { visible: true }`. After Log Back In the form is pre-filled, so use `reLoginWithCredentials` (no header login icon). Logging out kills the server session of a cached extra-user state (Team Management then shows 'Your session has expired'), so the spec deletes `.auth/<env>-<user>.json` in `afterAll`. `SmartPage.isVisible` waits for the element and throws if absent; use `present(key, timeout)` for optional elements.

## Open items

See "Known gaps" in the framework map (multi-user design, CI `dev` default,
non-Chromium browsers) and the tracker.
- Data-column users (e.g. KSP_User6): use `env.extraUsers`; call `ensureExtraUserState(browser, env, user)` (`src/fixtures/extra-user-session.ts`) in `beforeAll` and `test.use({ storageState: storageStatePath(env.name, user) })`. The session is cached in `.auth/<env>-<user>.json`, validated each run and re-created by login only if missing/expired. Run with `--no-deps`.
- Grid/dialog buttons are visible before their handlers bind: retry click with `expect(...).toPass` until the dialog opens (Column Selector). Selenium `findElements().size()` returns 0 without waiting; mirror it with a non-throwing count.
- Manage Assets Column Selector Apply triggers a delayed full page reload (verified on STG, ASTM_122): register `page.waitForEvent('framenavigated')` before clicking Apply and wait for the reloaded grid before touching pills/search.
- Optional elements probed for presence (leave-team button, toasts, etc.) need `heal: false` in YAML; with AI_HEAL=on the healer otherwise maps them to unrelated elements (seen: Leave Team -> Create New Team).
- GUEST (logged-out) scenarios: tests tagged @GUEST run in the <browser>-GUEST project (empty storage state, no auth dependency). Selenium isWebElementDisplayed returns a boolean that verify methods ignore, so stale XPaths passed there; Playwright asserts them, so fix the XPath against STG (login heading is 'Log in', not 'LOG IN'; the registration h1 is the 'Let''s get started with your account registration.' text).
