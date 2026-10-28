---
name: aiqa-ksp-migration
description: Mandatory, step-by-step procedure for migrating the Keysight KSP Selenium/Cucumber suite (ksp-test-automation) into this Playwright framework. Use for ANY request to migrate, port, convert or continue migrating a KSP module, feature file, scenario, DCX/SC/ASTM/SH test ID or tag; to work on tests/drafts or src/pages/drafts; to regenerate drafts (`npm run migrate:drafts`); to graduate a draft into a real test; or to fix a migrated KSP test. Load it together with docs/migration-playbook.md. Its rules are binding - follow them in order, do not skip steps.
---

# KSP Selenium → Playwright migration (strict procedure)

This skill is the contract for KSP migration work. Every rule below is a hard
rule: if one cannot be met, stop and tell the user why instead of working
around it. General Selenium mapping tables live in `aiqa-migrate-selenium`;
locator schema in `aiqa-locators`; house style in `aiqa-write-test`. Verified
fixes for specific KSP behaviours live in `docs/migration-playbook.md` — read it
before writing code.

## 0. What already exists (do not redo it)

| Artifact | Path | Owner |
| --- | --- | --- |
| Drafts of **every** feature (1 test per scenario / Examples row, all `test.fixme`) | `tests/drafts/*.spec.ts` | generator |
| Draft page objects for every Selenium page (untranslated methods `throw`) | `src/pages/drafts/*.page.ts` | generator |
| Locators for every page object (Selenium selector kept primary, tag `draft`) | `locators/<ns>.locators.yml` (new files start with `# DRAFT(migration)`; curated files get a `# >>> DRAFT(migration)` … `# <<<` block at the end) | generator |
| Work list: per feature/page counts, TODOs, unbound steps, missing roles | `docs/migration-drafts-report.md` | generator |
| Curated, verified tests | `tests/e2e/*.spec.ts`, `src/pages/*.page.ts`, YAML above any draft block | humans/agents |
| Status of finished modules | `docs/migration-tracker.md` | you, after each module |

The generator is `src/migration/drafts.ts`, run with:

```bash
npm run migrate:drafts -- --input ".\Selenium\ksp-test-automation"
```

The Selenium path comes from `SELENIUM_PROJECT_PATH` in `.env` (see
`docs/migration-framework-map.md`); `--input <dir>` overrides it. Run from the
repository root.

It is deterministic and idempotent. It **never** rewrites curated content: a
locator file without the `# DRAFT(migration)` first line, anything above the
`# >>>` block, `tests/e2e/`, `src/pages/*.page.ts`. A scenario whose test ID
appears anywhere in `tests/e2e/*.spec.ts` is dropped from the drafts on the next
run, so graduating a test removes its draft automatically.

## 1. Hard rules

1. **Selenium source is read-only.** Source of record:
   `$SELENIUM_PROJECT_PATH` (set in `.env`; your local checkout, branch `drishti_develop`;
   it may have uncommitted local changes — do not touch them). See `docs/migration-framework-map.md`. Run
   `git -C <source> status --short` before and after the task and confirm it
   is unchanged. This checkout is the source of record, not a
   reference-only copy. Do not require the historical macOS checkout on `main`.
2. **Branch** `develop_Sandeep` only. Never create/switch/delete branches, never
   commit unless the user asks. Stage by explicit path, never `git add .`.
3. **Environment comes from `.env`** (gitignored; template `.env.example`):
   `TEST_ENV=staging`, `AI_HEAL=off`, `CREDENTIALS_FILE=<path outside repo>`.
   Shell variables override it. Never switch to QA/prod unless the user says
   so. Never print, log, copy or commit a credential value — key names only.
4. **Never hand-edit generated drafts** (`tests/drafts/`, `src/pages/drafts/`,
   `# DRAFT(migration)` YAML, the `# >>>` blocks). Change the generator or
   graduate the code out of the draft area, then regenerate.
5. **No run may fail because of migration work.** Concretely:
   - a draft stays `test.fixme` until it has been graduated and passed on STG;
   - never un-fixme a draft in place;
   - a graduated test is committed only after it passed on STG with
     `AI_HEAL=off` (mutating tests: only after the user approved running them);
   - `npx tsc --noEmit` and `npx playwright test --list` must be clean before
     you finish.
6. **Never weaken anything to get green**: no dropped/softened assertions, no
   removed IDs or tags, no `waitForTimeout`, no `{ force: true }`, no blanket
   retries, no empty `catch`. A real application defect keeps its strict
   assertion and is reported (see §5).
7. **No selector in a spec.** Every element is a YAML key used through `ui` or a
   page object. Parameterised Selenium locators (`By fn(String)`, listed as
   comments in the YAML) are built in the page object from a base key plus
   `.filter({ hasText })` / `getByRole(..., { name })`, never inlined in a spec.
8. **Preserve coverage.** Every scenario / Examples row that existed in the
   feature must exist after migration — as a passing test, or as a labelled
   `test.fixme`/`test.fail` with the reason. Never silently drop one.
9. **Migrate only the requested scope** (module / IDs / tag).

## 2. Workflow per module (follow in order)

1. **Scope.** Resolve the request to `.feature` files under
   `<source>/src/test/java/scenarios/features`. Read
   `docs/migration-tracker.md` and the module's rows in
   `docs/migration-drafts-report.md` (rows, TODO steps, unbound steps, roles
   without a project, locator keys that differ from curated ones).
2. **Baseline.** `git -C <source> status --short` (save it), `git status
   --short` here.
3. **Read the source** for the scope: the feature, its step-definition classes
   (the draft spec names `Class.method() — file:line` for every step), the
   page objects, `hooks/Hooks.java`, any test data. Then read the draft spec
   and draft page object — they are the starting point, not the answer.
4. **Locators** (`aiqa-locators` skill for the schema):
   - New namespace: in `locators/<ns>.locators.yml` delete the first comment
     line `# DRAFT(migration) …` — from then on the generator treats the file
     as curated and only appends a block for keys that are still missing.
   - Existing curated namespace: move each key you need from the `# >>>`
     block to above it (cut/paste, then fix it). Do not edit inside the block.
   - For every key you keep: keep the Selenium selector as primary (XPath
     stays XPath), write a `description` saying what the element is *for*
     (the healer matches on it), remove the `draft` tag, add `index: first`
     only where duplicates are verified harmless, `heal: false` for elements
     that are probed for absence/optional presence, `multiple: true` for lists.
   - Where the draft key duplicates a curated key for the same element (e.g.
     `login.usernameField` vs `login.usernameInput`), use the curated key.
5. **Page object.** Move the methods you need from
   `src/pages/drafts/<ns>.page.ts` into `src/pages/<ns>.page.ts` (create it,
   or extend the curated one; drop the DRAFT header). Every method you move
   must have **no** `TODO(migration)` and **no** `throw`. Translate per §3.
   Return values from getters; put assertions in `expect…` methods.
6. **Spec.** Create or extend `tests/e2e/<kebab-feature>.spec.ts` in the house
   style (see `tests/e2e/product-safety-service-notes.spec.ts`):
   - `import { test, expect } from '../../src/fixtures/index.js'`;
   - feature tag on `test.describe`; one `test` per Examples row; title starts
     with the test ID; `tag: [feature tags, scenario tags, Examples tags,
     '@<ID>', '@<ROLE>']` — the role tag selects the Playwright project;
   - one `test.step` per Gherkin step, titled with the Gherkin text;
   - Background → `beforeEach`; login steps are done by the `auth-<ROLE>`
     project — keep `await login.expectLoggedIn()` in each test;
   - typed inline example rows, no secrets; shared data in `data/`;
   - `@notParallel` → `test.describe.configure({ mode: 'serial' })` per role;
   - mutating scenarios (create/update/delete in STG) get the `@mutating` tag.
7. **Static checks** — all must pass:
   ```bash
   npx tsc --noEmit
   npx playwright test --list --project=chromium-KSP --project=chromium-CAMSTHALES
   npx aiqa audit          # no new HIGH issue in the keys you curated
   ```
   Compare IDs and tags against the feature file: every row present, same IDs,
   same tags.
8. **Run on STG** (`.env` already sets staging + `AI_HEAL=off`):
   ```bash
   npx playwright test tests/e2e/<spec> --project=chromium-<ROLE> --workers=1 --grep "DCX-1234\b"
   ```
   Read-only tests first. **Ask before running `@mutating` tests.** Diagnose
   every failure with the `aiqa-debug-failure` skill and classify it (§5).
9. **Regenerate drafts** so graduated IDs leave `tests/drafts/`:
   `npm run migrate:drafts`,
   then re-run step 7.
10. **Record.** Update `docs/migration-tracker.md` (module, spec, tests, roles,
    what ran on STG and the result, what did not run and why). Add any new
    verified fix or quirk to `docs/migration-playbook.md`. Confirm the
    Selenium source `git status` equals the baseline.

## 3. KSP Selenium → framework mapping

`BasePage.java` helpers (the generator already applies these):

| Selenium (`BasePage`) | Framework |
| --- | --- |
| `clickOnElement(by)`, `clickJsUsingBy(by)`, `scrollAndClickUsingJS(by)`, `clickElementUsingAction(by)` | `this.click(key)` — a real click; if it is intercepted, find what covers the element, don't force it |
| `enterTextOnElement(by, v)` | `this.fill(key, v)`; React/Salesforce inputs that ignore fill → click + `ui.type` (playbook) |
| `clearText(by)` | `this.fill(key, '')` |
| `hoverOnElement(by)` | `this.hover(key)` |
| `selectFromDropDown(by, v)` | `this.select(key, v)`; custom (non-`<select>`) dropdowns → click + option by text |
| `getTextOnElement(by)` / `safeGetText` | `this.textOf(key)`; in assertions prefer `ui.expect(key).toHaveText(x, { useInnerText: true })` |
| `isWebElementDisplayed`, `isElementVisible`, `isElementPresent*` | `this.isVisible(key)` (non-waiting); in assertions `toBeVisible()` / `toBeHidden()` |
| `isWebElementEnabled`, `isElementClickable` | `toBeEnabled()` / `toBeDisabled()` |
| `sizeOfWebElements`, `getElementCount`, `findElements().size()` | `this.countOf(key)` (non-waiting, like Selenium) or `toHaveCount(n)` |
| `waitForPresenceOfElement`, `waitUntilElementIsDisplayed` | `ui.expect(key).toBeVisible()` |
| `waitForInvisibility*`, `waitForElementToDisappear` | `ui.expect(key).toBeHidden()` |
| `waitFor(n)`, `Thread.sleep`, spinner/page-load waits, `scroll*` | delete; the next action/web-first assertion waits. If flaky, assert the state that was being waited for |
| `waitForTitle(t)` / header checks | `ui.expect('<ns>.pageHeader').toHaveText(t)` |
| `switchToIframe` | `frame:` on the YAML element |
| `switchBetweenTabs`, `getWindowHandles` | `context.waitForEvent('page')` |
| downloads polled in a folder | Playwright `download` event (playbook) |
| `credsLoader.getProperty("X")` | never in specs — roles come from `env.users` / `env.extraUsers` |

Login-related Gherkin steps: `User open the Application` → `login.openApplication(env.startPath)`;
`User enter the login Credentials for '<R>' user` + `User click on the login button` → done by the
`auth-<R>` project; `User is logged in successfully` → `login.expectLoggedIn()`. A role without a
Playwright project (see the drafts report) must be added to `config/environments.ts` with
`fileUser(...)` keys from `docs/migration-framework-map.md` first; data-column users use
`env.extraUsers` + `ensureExtraUserState` (playbook).

## 4. Changing the generator

Fix a translation problem **in `src/migration/`** (java-parser, step-defs,
selenium-map, drafts) and regenerate — never patch generated output. After a
generator change: `npx tsc --noEmit`, regenerate, check that the curated YAML
files only gained/lost content inside their `# >>>` blocks
(`git diff locators/`), `npx playwright test tests/drafts --no-deps` → all
skipped, 0 failed.

## 5. Classifying a failure (report it, never hide it)

| Class | Action |
| --- | --- |
| Automation defect (locator, wait, flow) | fix it; record the fix in the playbook if it is reusable |
| Application defect | keep the assertion strict; report evidence to the user; with the user's approval mark `test.fail(true, 'App defect: <evidence/ticket>')` so the run stays green and flips when the app is fixed |
| Environment / connectivity | report; do not mark passed |
| Credential / permission (missing key, locked user) | report the **key name**; never invent keys |
| Test data / setup | fix the data or seeding; report if STG data is missing |
| Inconclusive | report what is known; do not claim a pass |

## 6. Done means

- [ ] every scenario/row in scope exists in `tests/e2e/` with ID + role tags (or is a labelled `fixme`/`fail` with reason)
- [ ] no `TODO(migration)`, `throw`, selector or `waitForTimeout` in the curated spec/page
- [ ] each used YAML key curated: real description, no `draft` tag, verified on STG
- [ ] `tsc`, `--list`, ID/tag parity clean; STG run results recorded honestly
- [ ] drafts regenerated; tracker + playbook updated; Selenium source unchanged
