---
name: aiqa-migrate-selenium
description: Convert an existing Selenium suite into this framework. Use when the request mentions migrating, porting or converting Selenium, WebDriver, Java tests, TestNG, JUnit, Cucumber, BDD, .feature files, step definitions, Gherkin, @FindBy, PageFactory, or "we have existing tests we want to move". Also use when reviewing or finishing a migration draft, resolving TODO(migration) markers, or deciding what a Selenium idiom should become. Contains the command, the mapping tables and the review workflow.
---

# Migrating a Selenium suite

Handles plain TestNG/JUnit page-object suites **and** Cucumber BDD. The
converter is deterministic and offline: it never guesses, and everything it
cannot translate becomes a `TODO(migration)` carrying the original Java.

## Commands

```bash
npx aiqa migrate --analyze                      # what is in there?
npx aiqa migrate                                # drafts -> migration/output/
npx aiqa migrate --input ./legacy --out ./draft # explicit paths
npx aiqa migrate --apply                        # install into the framework
npx aiqa migrate --url https://app.test/login   # meta.url for the locators
```

Default input is the `SELENIUM_PROJECT_PATH` variable from `.env` (`--input`
overrides it; neither set or a bad path is an error, never a fallback). **Nothing is written outside
`migration/output/` unless `--apply` is passed.** Existing files are backed
up to `.bak` before being replaced.

Read `migration/output/MIGRATION-REPORT.md` before anything else — it is the
work list.

## What maps to what

| Selenium / Cucumber | Framework |
| --- | --- |
| `@FindBy` / `By` field | an entry in `locators/<ns>.locators.yml` |
| `List<WebElement>` | `multiple: true` |
| Javadoc on the field | the locator `description` |
| Page-object class | `src/pages/<ns>.page.ts`, behaviour only |
| `return el.getText()` | `async getX(): Promise<string> { return this.textOf('el') }` |
| Test class | `tests/e2e/<ns>.spec.ts` |
| `@BeforeMethod`/`@BeforeEach`/`@Before` | `test.beforeEach` |
| `@Test(groups=…)` / `@Tag` | Playwright tags (`@smoke`) |
| `@Test(enabled=false)` / `@Disabled` | `test.skip` |
| `.feature` file | one spec per feature |
| Scenario | a `test` |
| Given/When/Then | a named `test.step` |
| Background | `test.beforeEach` |
| Scenario Outline row | its own `test` (as Cucumber runs them) |
| `el.click()` | `await ui.click('ns.el')` |
| `el.sendKeys("x")` | `await ui.fill('ns.el', 'x')` |
| `el.sendKeys(Keys.ENTER)` | `await ui.press('ns.el', 'Enter')` |
| `new Select(el).selectByVisibleText` | `await ui.selectOption('ns.el', …)` |
| `wait.until(visibilityOf(el))` | `await ui.expect('ns.el').toBeVisible()` |
| `assertEquals(el.getText(), "x")` | `await ui.expect('ns.el').toHaveText('x')` |
| `assertEquals(page.getX(), "x")` | `expect(await page.getX()).toBe('x')` |
| `driver.get(url)` | `await ui.goto(url)` |

## Locator quality — the part that matters

Upgrades happen **only when provably equivalent**:

| From | To | Quality |
| --- | --- | --- |
| `linkText` / `partialLinkText` | `getByRole('link', { name })` | good |
| `//*[@data-testid='x']` | `getByTestId('x')` | good |
| `//button[text()='Save']` | `getByRole('button', { name })` | good |
| `//*[@id='x']`, `//input[@name='q']` | CSS | fair |
| `id`, `name`, `css` | CSS | fair |
| `className`, `tagName`, opaque XPath | CSS / XPath, flagged | poor |

The original selector is always kept as a `fallback`, so a migration is
reversible. The report lists every `fair`/`poor` locator under **Worth
rewriting** — those are the real follow-up work.

To upgrade them against the live app:

```bash
npx aiqa scan https://app.test/login --name login
npx aiqa audit
```

## Deliberately not translated — do not "fix" these by guessing

| Selenium | What it should become |
| --- | --- |
| `Thread.sleep(n)` | Assert the condition it waited for. `ui.expect(key)` retries. **Never** port it to `waitForTimeout`. |
| `implicitlyWait` | Delete it. Playwright auto-waits on every action. |
| `JavascriptExecutor` | Re-express as a real interaction, or a deliberate `page.evaluate()`. |
| `Actions` chains | `ui.dragTo`, `ui.hover`, `page.keyboard`. |
| `switchTo().frame()` | `frame:` on the locator in YAML. |
| `switchTo().window()/alert()` | `page.on('dialog')`, `context.waitForEvent('page')`. |
| `manage().window()` | `viewport` in `playwright.config.ts`. |
| Data providers | Move cases into `data/`, read via the `dataset` fixture. |

These are Selenium idioms that exist because Selenium lacks auto-waiting and
a semantic locator engine. Porting them imports the flakiness they were
written to work around.

## Reviewing a migration

Work in this order:

1. **Read the report.** Coverage, unbound Gherkin steps, locators worth
   rewriting, per-file table.
2. **Resolve every `TODO(migration)`.** Each carries the original Java. An
   unbound Gherkin step is emitted as a test that *throws* — it must be
   implemented or deleted, never left.
3. **Rewrite `poor` locators.** Use `aiqa scan` against the real page.
4. **Sharpen every `description`.** Generated ones read
   "(migrated from Selenium id "user-name")" — that is a placeholder. The
   healer matches on this field, so a vague description permanently weakens
   the element. See the `aiqa-locators` skill.
5. **Verify.**
   ```bash
   npx tsc --noEmit
   npx aiqa audit
   npm test
   ```

## Rules while migrating

- Preserve coverage. If a scenario existed, it must still exist — skipped and
  labelled if it cannot run yet, never silently dropped.
- Never weaken an assertion to make a migrated test pass. A migrated test that
  fails is information: either the translation is wrong or the app is.
- Do not hand-edit `migration/output/` expecting it to persist — it is
  regenerated. Edit after `--apply`, in `locators/`, `tests/e2e/`, `src/pages/`.
- Keep `.feature` files in the repo if stakeholders read them; the generated
  specs preserve the Gherkin structure as `test` + `test.step`, so both stay
  readable. `playwright-bdd` is the alternative if you want to run `.feature`
  files directly.

## Limits — state these honestly

The Java reader is targeted at Selenium patterns, not a full Java grammar. It
reliably reads `@FindBy`/`By` fields, method bodies, annotations and Cucumber
glue; it does not evaluate expressions, follow inheritance chains, or resolve
values computed at runtime. Output is a reviewed starting point that preserves
coverage — not a finished suite. Say so when reporting a migration.
