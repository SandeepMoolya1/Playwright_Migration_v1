# Migrating an existing Selenium (Java) suite

Point `SELENIUM_PROJECT_PATH` (in `.env`) at your existing suite — or pass `--input` — run one command, and get back
framework-shaped drafts plus a report of everything that needs a human.

```bash
# set SELENIUM_PROJECT_PATH in .env (or pass --input)
npx aiqa migrate --analyze          # what's in there?
npx aiqa migrate                    # write drafts to migration/output/
# ...review the report and the drafts...
npx aiqa migrate --apply            # install into locators/, tests/e2e/, src/pages/
```

Nothing is written outside `migration/output/` until you pass `--apply`.

## What it handles

| Source | Becomes |
| --- | --- |
| `@FindBy` / `By.*` fields | `locators/<page>.locators.yml` entries |
| Page-object classes | `src/pages/<page>.page.ts` (behaviour only) |
| Page-object getters (`return el.getText()`) | typed accessors (`Promise<string>`) |
| TestNG / JUnit 4 / JUnit 5 test classes | `tests/e2e/<name>.spec.ts` |
| `@BeforeMethod` / `@BeforeEach` / `@Before` | `test.beforeEach` |
| `@Test(description=…)`, `@DisplayName` | the test title |
| `@Test(groups=…)`, `@Tag` | Playwright tags (`@smoke`) |
| `@Test(enabled=false)`, `@Disabled`, `@Ignore` | `test.skip` |
| **Cucumber `.feature` files** | one spec per feature |
| **Scenario** | a `test` |
| **Given/When/Then** | a named `test.step` |
| **Background** | `test.beforeEach` |
| **Scenario Outline + Examples** | one test per row |
| **Feature/Scenario tags** | Playwright tags |
| **Step definitions** (expression *and* regex dialects) | the step bodies |

## Locator translation

Selenium locators are translated faithfully, and **upgraded only where the
upgrade is provably equivalent**:

| From | To | Quality |
| --- | --- | --- |
| `linkText` / `partialLinkText` | `getByRole('link', { name })` | good |
| `//*[@data-testid='x']` | `getByTestId('x')` | good |
| `//button[text()='Save']` | `getByRole('button', { name: 'Save' })` | good |
| `//*[@id='x']` | `#x` | fair |
| `//input[@name='q']` | `input[name="q"]` | fair |
| `id` / `name` / `css` | CSS | fair |
| `className` / `tagName` | CSS | poor |
| unrecognised XPath | XPath, flagged | poor |

Anything less certain is translated literally and listed in the report under
**Worth rewriting**. The original selector is always kept as a `fallback`, so
a migration is reversible.

To upgrade the weak ones against your real application:

```bash
npx aiqa scan https://your-app/login --name login   # draft semantic locators
npx aiqa audit                                      # what still needs work
```

## What it deliberately does *not* translate

These become `TODO(migration)` comments carrying the original Java, never a
guess:

| Selenium | Why, and what to do |
| --- | --- |
| `Thread.sleep(n)` | A hard wait. Assert the condition it was waiting for — `ui.expect(key)` retries. |
| `implicitlyWait` | Playwright auto-waits on every action. Delete it. |
| `JavascriptExecutor` | Usually a workaround for something Playwright does natively. Re-express as a real interaction. |
| `Actions` chains | Use `ui.dragTo`, `ui.hover`, `page.keyboard`. |
| `switchTo().frame()` | Declare `frame:` on the locator in YAML. |
| `switchTo().window()/alert()` | `page.on('dialog')`, `context.waitForEvent('page')`. |
| `manage().window()` | Set `viewport` in `playwright.config.ts`. |
| `Robot` / AWT | No equivalent. Rethink the scenario. |
| Data providers | Move the cases into `data/` and read them via `dataset`. |

These are not gaps in the converter. They are Selenium idioms that exist
because Selenium lacks auto-waiting and a semantic locator engine — carrying
them across would import the flakiness they were written to work around.

## The report

`migration/output/MIGRATION-REPORT.md` tells you:

- how much translated automatically, and what did not
- every locator worth rewriting, with the original selector and why
- every unbound Gherkin step
- a per-file table of what was produced
- an ordered list of next steps

Unbound Gherkin steps become tests that **throw**, so they fail loudly rather
than passing vacuously.

## After `--apply`

```bash
npx aiqa audit          # locator quality gate
npx tsc --noEmit        # the drafts must compile
npm test                # run them
```

Then work through the checklist at the top of each generated spec:

1. Resolve every `TODO(migration)`.
2. Replace `poor` locators with role or test-id ones.
3. Sharpen every locator `description` — it is what auto-healing matches on,
   and the generated ones are serviceable, not good.
4. Confirm the assertions still assert something meaningful.

## Keeping your `.feature` files

The generated specs need no BDD runner, which is why that is the default: the
Gherkin structure survives as `test` + `test.step`, so the HTML report and the
trace still read like the feature file.

If business stakeholders read the `.feature` files, keep them in the
repository as the source of truth for *intent* and treat the specs as the
implementation — or adopt `playwright-bdd`, which runs `.feature` files
directly. Both work here, because the step bodies only ever call the `ui`
fixture.

## Layout

```
migration/
  inbox/      drop your Selenium sources here (gitignored)
  output/     generated drafts and the report (gitignored)
  examples/   a realistic sample suite, used to verify the converter
```

`examples/selenium-java/` is a working TestNG + Cucumber suite covering
`@FindBy` variants, `By` fields, page objects, waits, assertions,
`Thread.sleep`, `JavascriptExecutor`, `Actions`, a data provider, a feature
file with a Background and a Scenario Outline, and both step-definition
dialects. Run the converter against it to see the output shape:

```bash
npx aiqa migrate --input migration/examples/selenium-java
```

## Limits, stated plainly

The Java reader is targeted at Selenium patterns, not a full Java grammar. It
reads `@FindBy`/`By` fields, method bodies, annotations and Cucumber glue
reliably; it does not evaluate expressions, follow inheritance chains, or
resolve values computed at runtime. Anything it cannot model is reported —
it never invents a translation. Treat the output as a reviewed starting point
that preserves your coverage, not as a finished suite.
