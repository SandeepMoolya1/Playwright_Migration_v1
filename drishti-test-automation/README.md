# ai-playwright-framework

A Playwright E2E framework for web testing, built on two ideas:

1. **Locators live in YAML, never in specs.** Every element a test touches is
   declared in `locators/*.locators.yml` and referenced by key. That single
   indirection is what makes healing, auditing and codegen possible.
2. **AI is the last resort, not the first.** Healing, generation and failure
   analysis are real capabilities, but each runs behind deterministic tiers
   that solve the common cases offline, for free, in milliseconds.

```ts
test('a user can check out', async ({ ui }) => {
  await ui.goto('/cart');
  await ui.fill('cart.promoInput', 'SAVE10');
  await ui.click('cart.applyPromoButton');
  await ui.expect('cart.orderTotal').toHaveText('$89.99');
});
```

No selector appears in that test. When the UI changes the YAML heals, and the
run tells you exactly what it healed and why.

---

## Contents

- [Quick start](#quick-start)
- [Architecture](#architecture)
  - [Layers](#layers)
  - [Request flow: resolving one element](#request-flow-resolving-one-element)
  - [The healing cascade](#the-healing-cascade)
  - [Repository layout](#repository-layout)
  - [Module map](#module-map)
  - [Data and artifacts](#data-and-artifacts)
- [The locator repository](#the-locator-repository)
- [Writing tests](#writing-tests)
- [Running against different environments](#running-against-different-environments)
- [Test data](#test-data)
- [Command reference](#command-reference)
- [Configuration reference](#configuration-reference)
- [Debugging a failure](#debugging-a-failure)
- [Migrating from Selenium](#migrating-from-selenium)
- [Skills](#skills)
- [Playwright Agents](#playwright-agents)
- [CI](#ci)
- [Recipes](#recipes)

---

## Quick start

```bash
npm install
npx playwright install --with-deps
cp .env.example .env          # optional: add ANTHROPIC_API_KEY
npm test                      # runs the example suites
npx aiqa doctor               # verify the environment
```

The example suites run against the public TodoMVC demo, so they work
immediately with no setup and **no API key**. `tests/e2e/healing.spec.ts`
proves the healing cascade offline.

Requirements: Node 22+ (tested on 26), Playwright 1.56+.

---

## Architecture

### Layers

Each layer depends only on the ones below it. The AI layer sits *beside* the
deterministic core rather than inside it, which is why every AI feature has a
working offline path.

```
┌──────────────────────────────────────────────────────────────────────┐
│  TESTS                tests/**/*.spec.ts, src/pages/*.page.ts        │
│  Reference elements by key. Never contain a selector.                │
└───────────────┬──────────────────────────────────────────────────────┘
                │  ui.click('cart.promoInput')
┌───────────────▼──────────────────────────────────────────────────────┐
│  FIXTURES             src/fixtures/                                  │
│  `test` object: ui · find · locators · heals · diagnostics           │
│  Wraps actions in test.step(); captures console + network.           │
└───────────────┬──────────────────────────────────────────────────────┘
                │  resolveWithHealing({ page, element })
┌───────────────▼──────────────────────────────────────────────────────┐
│  HEALING              src/ai/healer.ts                               │
│  4-tier cascade. Validates every proposal against the live page.     │
└──┬──────────────┬─────────────────┬────────────────────┬─────────────┘
   │              │                 │                    │
┌──▼───────────┐ ┌▼───────────────┐ ┌▼─────────────────┐ ┌▼───────────┐
│ LOCATORS     │ │ DOM CAPTURE    │ │ MATCHER          │ │ AI CLIENT  │
│ src/locators │ │ src/dom/       │ │ src/dom/         │ │ src/ai/    │
│              │ │  snapshot.ts   │ │  candidates.ts   │ │  client.ts │
│ schema       │ │ a11y tree +    │ │ deterministic    │ │ Anthropic  │
│ repository   │ │ candidate list │ │ scoring, offline │ │ structured │
│ resolver     │ │                │ │                  │ │ output     │
│ writer       │ │                │ │                  │ │            │
└──────┬───────┘ └────────────────┘ └──────────────────┘ └────────────┘
       │
┌──────▼───────────────────────────────────────────────────────────────┐
│  YAML                 locators/*.locators.yml                        │
│  The single source of truth. Human-written, machine-maintained.      │
└──────────────────────────────────────────────────────────────────────┘

        ┌──────────────────────────────────────────────────┐
        │  OUT-OF-BAND (no test run required)              │
        │  src/cli/       aiqa scan · gen · check · audit  │
        │  src/reporting/ heal summary · failure analysis  │
        └──────────────────────────────────────────────────┘
```

**Why the indirection earns its keep.** Because the framework always knows
*which declared element* an action belongs to, it can: heal that element and
apply the fix to the rest of the run; write the fix back to source with an
audit trail; probe the whole repository against an environment before any test
runs; statically audit selector quality; and regenerate a page's locators
without touching a single spec. None of that is possible when a selector is a
string literal buried in a test.

### Request flow: resolving one element

```
ui.click('cart.promoInput')
   │
   ├─ 1. LocatorRepository.get('cart.promoInput')
   │        reads locators/cart.locators.yml (parsed + cached once per worker)
   │        → { definition, sourcePath, meta }
   │        unknown key → UnknownElementError with "did you mean" suggestions
   │
   ├─ 2. resolveWithHealing({ page, element, timeout })
   │        → tier 0..3 (see below)
   │        → { locator, healed? }
   │
   ├─ 3. if healed:
   │        · repository patched in memory   (rest of the worker reuses it)
   │        · record appended to .ai/heal-journal.jsonl
   │        · annotation added to the test   (visible in the HTML report)
   │        · YAML rewritten                 (if persist + confidence allow)
   │        · AI_HEAL_STRICT=on → throw      (drift gate)
   │
   └─ 4. locator.click()  — ordinary Playwright from here on
```

### The healing cascade

Cheapest and most certain first. **Every tier's proposal is validated against
the live page before it is used** — the model never gets to fix anything by
assertion alone.

```
  ┌─────────────────────────────────────────────────────────────┐
  │ TIER 0  Primary chain                        free · offline │
  │ The locator exactly as written, waited for with the test's  │
  │ real timeout. A slow-rendering element must never be        │
  │ mistaken for a broken one.                                  │
  └───────────────────────────┬─────────────────────────────────┘
                     resolves │ ──────────────────────► done
                              ▼ fails
  ┌─────────────────────────────────────────────────────────────┐
  │ TIER 1  Declared fallbacks                   free · offline │
  │ The alternatives the engineer wrote in the YAML, in order.  │
  │ An intended alternative is not drift → never rewrites YAML. │
  └───────────────────────────┬─────────────────────────────────┘
                              ▼ fails
              ┌───────────────────────────────┐
              │ capture the page:             │
              │  · aria snapshot (semantic)   │
              │  · candidate list + unique    │
              │    CSS path per element       │
              │  · structural signature       │
              └───────────────┬───────────────┘
                              │
                   cache hit? ├──► reuse previous heal ──► done
                              ▼
  ┌─────────────────────────────────────────────────────────────┐
  │ TIER 2  Deterministic matcher                free · offline │
  │ Scores every live candidate against the declared intent:    │
  │   · identifiers (test id, id, label, placeholder)  w 0.34   │
  │   · accessible name                                w 0.30   │
  │   · visible text                                   w 0.07   │
  │   · agreement between identifier and name          w 0.10   │
  │   · high-signal core tokens                        w 0.05   │
  │   · role implied by the description                w 0.14   │
  │ Plus: the only visible element of the intended kind → 0.82. │
  │ Accepted only if it is an UNAMBIGUOUS WINNER.               │
  └───────────────────────────┬─────────────────────────────────┘
                              ▼ no clear winner
  ┌─────────────────────────────────────────────────────────────┐
  │ TIER 3  AI matcher                            one API call  │
  │ Claude receives the intent, the failed locator, the aria    │
  │ tree and the candidate list; returns ranked proposals with  │
  │ calibrated confidence, or elementMissing: true.             │
  │ Each proposal is probed against the page in order.          │
  └───────────────────────────┬─────────────────────────────────┘
                              ▼ all rejected
              ElementNotFoundError, with the full audit trail
```

Two safeguards do the real work:

- **Unambiguous winner.** If two elements score similarly the deterministic
  tier declines rather than guess. That is exactly the case where clicking the
  wrong control does damage — and exactly where the AI tier earns its cost.
  Candidates that resolve to the *same* locator (every row of a list) are
  collapsed first, so a collection is never mistaken for ambiguity.
- **Uniqueness.** A healed locator must resolve to exactly one element, unless
  the element is declared `multiple: true`. A replacement matching five things
  is not a repair.

An element that genuinely does not exist still fails, loudly:

```
✖ ElementNotFoundError: Could not resolve "todoDrift.ghostWidget"
    Attempted:
      - getByTestId('fx-conversion-widget') -> Timeout 1000ms exceeded.
      - heuristic: no clear winner (best 0.00, runner-up n/a)
    Fix: update the locator in YAML, or run `npx aiqa scan <url>` to regenerate it.
```

### Repository layout

```
config/
  environments.ts  environment registry: URLs, users, feature flags, readOnly
data/
  default.json     reference data shared by every environment
  <env>.json       per-environment overrides, deep-merged over default
locators/
  *.locators.yml   the locator repository
tests/
  e2e/             specs
  auth.setup.ts    signs in once per role, saves storage state to .auth/
  seed.spec.ts     seed test the generator agent mirrors
specs/             Markdown test plans written by the planner agent
migration/
  inbox/           drop an existing Selenium suite here (gitignored)
  output/          generated drafts + MIGRATION-REPORT.md (gitignored)
  examples/        a worked TestNG + Cucumber suite, used to verify the converter
tools/
  fixture-api.mjs  bundled REST API for the framework's own self-tests
src/
  core/            config resolution, logging, shared types
  locators/        YAML schema, repository, resolver, comment-preserving writer
  dom/             page capture (a11y tree + candidates), deterministic matcher
  ai/              client, prompts, schemas, healer, scanner, generator, analyzer
  data/            datasets, factories, run identity, app-state + API seeding
  migration/       Selenium/Java + Gherkin readers, mappers and emitters
  fixtures/        the `test` object and the `ui` action surface
  pages/           page objects (behaviour only — no selectors)
  reporting/       custom reporter: heal summary + failure analysis
  cli/             the `aiqa` command
global-setup.ts    fixes the run id shared by every worker
playwright.config.ts
aiqa.config.ts     framework configuration
aiqa.setup.ts      page preconditions for `aiqa check`
.env.example       shared variables; .env.<name> holds per-environment ones
CLAUDE.md          conventions, binding on all agents
.mcp.json          MCP servers
```

### Module map

| Path | Responsibility |
| --- | --- |
| `src/core/types.ts` | Every shared type. The `LocatorDefinition` shape is the contract the whole framework agrees on. |
| `src/core/config.ts` | Config resolution: defaults → `aiqa.config.ts` → env. Credential detection. |
| `src/core/logger.ts` | Leveled logger. |
| `src/locators/schema.ts` | Parses and **normalises** the three accepted YAML shorthands into one canonical definition. |
| `src/locators/repository.ts` | Loads every `*.locators.yml`, caches per worker, resolves dotted keys, "did you mean" hints. |
| `src/locators/resolver.ts` | The **only** place that calls `getByRole` / `locator()` etc. Definition → live `Locator`. |
| `src/locators/writer.ts` | Comment-preserving YAML write-back via the `yaml` Document API. Demotes the old selector to `fallbacks`. |
| `src/dom/snapshot.ts` | One `page.evaluate` round-trip: aria tree + candidate list with verified-unique CSS paths + structural signature. |
| `src/dom/candidates.ts` | Deterministic scoring and the clear-winner rule. No AI, no network. |
| `src/ai/client.ts` | Anthropic wrapper. Schema-constrained output, prompt caching, typed error handling, token ledger. Returns `null` rather than throwing. |
| `src/ai/prompts.ts` | System prompts. Static, so the cached prefix stays valid across heals. |
| `src/ai/schemas.ts` | Zod validators paired with the JSON Schemas sent to the API, written together so they cannot drift. |
| `src/ai/healer.ts` | The cascade, the heal journal, the heal cache, persistence decisions. |
| `src/ai/scanner.ts` | Live page → locator YAML (AI-named, or deterministic with `--no-ai`). |
| `src/ai/generator.ts` | Two-phase codegen: bounded browser exploration, then a structured write. |
| `src/ai/analyzer.ts` | Root-cause analysis from saved artifacts. Runs in the reporter, not the test. |
| `config/environments.ts` | The environment registry. Resolves `TEST_ENV`, loads `.env.<name>` then `.env`, and reads secrets **lazily** so `local` never needs staging credentials. |
| `src/data/dataset.ts` | Per-environment reference data: `default.json` merged with `<env>.json`, validated by a Zod schema. |
| `src/data/factory.ts` | Builders for test-owned data, tagged with the run id. |
| `src/data/run.ts` | Run identity. One id per run, shared by every worker. |
| `src/data/app-state.ts` | Seed storage and cookies directly, stub responses — state without the UI. |
| `src/data/seeder.ts` | API fixture data with guaranteed, reverse-order cleanup and a read-only guard. |
| `src/migration/java-parser.ts` | A targeted Java reader for Selenium patterns. Structural scanning runs over a *mask* where strings and comments are blanked, so a `}` in a string cannot derail brace matching. |
| `src/migration/selenium-map.ts` | The mapping tables: Selenium locator → `LocatorStep` (upgrading only where provably equivalent), and Java statement → `ui` call. Also the list of constructs that must never be guessed at. |
| `src/migration/gherkin.ts` | Gherkin reader: tags, Background, Scenario, Scenario Outline + Examples, doc strings, data tables. |
| `src/migration/step-defs.ts` | Cucumber step definitions and matching. Handles both dialects — Cucumber Expressions (`{string}`, `{int}`, optionals, alternation) and raw regex. |
| `src/migration/emit.ts` | Inventory → YAML locators, framework page objects, spec drafts and BDD specs. |
| `src/migration/index.ts` | Orchestration and the migration report. |
| `tools/fixture-api.mjs` | A dependency-free in-memory REST API backing `local.apiURL`, so the seeding path is exercised for real. Delete it when you point the framework at your own API. |
| `src/fixtures/index.ts` | The `test` object and its fixtures. |
| `src/fixtures/smart-page.ts` | `ui` — actions and web-first assertions, keyed by locator name, each wrapped in `test.step()`. |
| `src/fixtures/capture.ts` | Console and network capture, attached on failure. |
| `src/pages/base.page.ts` | Page-object base. Behaviour only; selectors stay in YAML. |
| `src/reporting/ai-reporter.ts` | Heal summary, failure analysis, `.ai/report/analysis.md`. |
| `src/cli/` | The `aiqa` command. |

### Data and artifacts

| File | Written by | Committed? |
| --- | --- | --- |
| `locators/*.locators.yml` | you, and the healer on write-back | **yes** |
| `data/*.json` | you | **yes** |
| fixture API state | `tools/fixture-api.mjs`, in memory | n/a — discarded on exit |
| `.env`, `.env.<name>` | you | **no** — secrets |
| `.auth/<env>-<role>.json` | the `auth` setup project | **no** — live sessions |
| `.ai/heal-journal.jsonl` | healer, one line per heal | no |
| `.ai/heal-journal.prev.jsonl` | reporter, rotated at run start | no |
| `.ai/heal-cache.json` | healer, keyed by element + page signature | no |
| `.ai/report/analysis.md` / `.json` | reporter | no |
| `test-results/**/trace.zip`, video, screenshot | Playwright | no |
| `ai-diagnostics.json` / `.md` | `diagnostics` fixture, as test attachments | no |

The journal is rotated at the start of every run, so a run's summary contains
only that run's heals while the previous run stays recoverable.

---

## The locator repository

```yaml
meta:
  name: cart                 # namespace → `cart.promoInput`
  description: Shopping cart
  url: /cart                 # enables `aiqa check`
  state: seeded              # optional precondition, see aiqa.setup.ts
  testIdAttribute: data-qa   # per-file override
  persistHeals: false        # heal at runtime, never rewrite this file

elements:
  promoInput:
    description: Field in the order summary where a discount code is entered
    role: textbox
    name: Promo code
    fallbacks:
      - { testId: promo-code }
      - { css: "#promo" }

  cartRows:
    description: One row per line item in the cart table
    testId: cart-row
    multiple: true           # a collection; matching many is expected

  firstRowRemoveButton:
    description: The remove control inside the first cart line item
    steps:
      - { strategy: testId, text: cart-row }
      - { strategy: role, role: button, name: Remove }
    index: first
```

### Three levels of verbosity

All normalise to the same definition — use the least you need:

```yaml
submitButton: "#submit"                          # shorthand string
submitButton: { role: button, name: Sign in }    # inferred strategy
submitButton:                                    # explicit chain
  steps:
    - { strategy: role, role: table, name: Cart }
    - { strategy: role, role: row }
  filter: { hasText: "Widget" }
  index: first
```

A bare string infers its engine the way `page.locator()` does: `xpath=…`,
`css=…`, `text=…`, a leading `//` means XPath, anything else is CSS.

### Strategies

Every Playwright locator method is supported:

| `strategy` | YAML key | Playwright |
| --- | --- | --- |
| `testId` | `testId:` | `getByTestId()` |
| `role` | `role:` + `name:` | `getByRole()` |
| `label` | `label:` | `getByLabel()` |
| `placeholder` | `placeholder:` | `getByPlaceholder()` |
| `text` | `text:` | `getByText()` |
| `altText` | `altText:` | `getByAltText()` |
| `title` | `title:` | `getByTitle()` |
| `css` | `css:` | `locator()` |
| `xpath` | `xpath:` | `locator('xpath=…')` |

Plus `exact:`, and `regex: true` with `flags:` to treat `name`/`text` as a
regular expression.

**Preference order:** `testId` → `role`+`name` → `label` / `placeholder` →
`text` → `css`. XPath is a last resort. The healer rebuilds in this order, and
`aiqa audit` enforces it.

### Element fields

| Field | Meaning |
| --- | --- |
| `description` | **The intent.** What healing matches against. Always write one. |
| `steps` | Resolution chain; each step narrows the previous. |
| `fallbacks` | Alternatives tried before any inference. A list of steps or step-chains. |
| `filter` | `hasText` / `hasNotText` / `has` / `hasNot` / `visible`. |
| `index` | `first`, `last`, or a number (`nth`). |
| `multiple` | Collection: ambiguity is expected, not a defect. |
| `frame` | Resolve inside this iframe (`frameLocator`) first. |
| `heal` | `false` disables healing for this element. |
| `tags` | Free-form, surfaced by `aiqa audit`. |
| `healedAt` / `healedFrom` | Written by the framework. Don't hand-edit. |

### File fields (`meta`)

| Field | Meaning |
| --- | --- |
| `name` | Namespace. Defaults to the file stem. |
| `description` | What this page is. |
| `url` | Path, relative to `baseURL`. Required for `aiqa check`. |
| `state` | Precondition name resolved from `aiqa.setup.ts`. |
| `testIdAttribute` | Per-file override of the global test-id attribute. |
| `persistHeals` | `false` to heal at runtime but never rewrite this file. |

### Why `description` deserves the emphasis

When a selector stops resolving, the description is the only surviving
statement of what the test *meant*. The deterministic matcher reads it for
both vocabulary and the implied kind of control, and the AI tier uses it as
the intent. "Primary call-to-action that submits the login form" recovers;
"login button" often does not.

### Healing never hides drift

- Every heal is annotated on the test in the HTML report.
- Every heal is journalled and summarised in the terminal.
- Locally, an accepted heal above `persistMinConfidence` is **written back**:
  the old selector is demoted to `fallbacks` and stamped with `healedFrom`, so
  it is reversible by hand and shows up in code review as a diff.
- In CI, `persist` is off: CI reports drift, humans decide.
- `AI_HEAL_STRICT=on` fails any test that only passed because it healed.

```yaml
newTodoInput:
  description: Text field at the top where a new todo is typed
  role: textbox                            # healed
  name: What needs to be done?
  fallbacks:
    - css: "#new-todo-input-v2-renamed"    # demoted, not deleted
  healedAt: 2026-09-28T05:56:34.096Z
  healedFrom: locator('#new-todo-input-v2-renamed')
```

---

## Writing tests

```ts
import { test, expect } from '../../src/fixtures/index.js';

test.describe('Checkout', () => {
  test('applies a promo code', async ({ ui }) => {
    await ui.goto('/cart');

    await test.step('apply the code', async () => {
      await ui.fill('cart.promoInput', 'SAVE10');
      await ui.click('cart.applyPromoButton');
    });

    await ui.expect('cart.discountRow').toBeVisible();
    await ui.expect('cart.orderTotal').toHaveText('$89.99');
  });
});
```

### Fixtures

| Fixture | Type | Purpose |
| --- | --- | --- |
| `ui` | `SmartPage` | Actions and assertions keyed by locator name. |
| `find` | `(key, opts?) => Promise<Locator>` | Raw locator resolution, already healed. |
| `locators` | `LocatorRepository` | `keys()`, `has()`, `get()`, `namespaces()`. |
| `heals` | `HealRecord[]` | What healed during this test. |
| `diagnostics` | `CaptureBuffers` | Console and network buffers for this test. |

### The `ui` surface

| Group | Methods |
| --- | --- |
| Navigation | `goto(path, { waitUntil })` |
| Actions | `click` · `dblclick` · `fill` · `type` · `press` · `check` · `uncheck` · `selectOption` · `hover` · `setInputFiles` · `dragTo` |
| Queries | `textOf` · `valueOf` · `count` · `isVisible` · `locator` |
| Assertions | `expect(key).toBeVisible / toBeHidden / toBeEnabled / toBeDisabled / toBeChecked / toHaveText / toContainText / toHaveValue / toHaveCount / toHaveAttribute` |
| Page-level | `expectUrl` · `expectTitle` · `screenshot(name)` |

All assertions are Playwright's **retrying** web-first assertions.
`waitForTimeout` is not used anywhere in this framework and should not appear
in your tests. `ui.locator(key)` is the escape hatch for anything `ui` does
not cover — it returns a plain healed `Locator`.

### Page objects

Behaviour only; selectors stay in YAML:

```ts
import { BasePage } from '../../src/pages/base.page.js';

export class CartPage extends BasePage {
  constructor(ui: SmartPage) { super(ui, 'cart'); }   // 'cart' is the namespace

  async applyPromo(code: string) {
    await this.fill('promoInput', code);              // → cart.promoInput
    await this.click('applyPromoButton');
  }

  async expectTotal(value: string) {
    await this.expect('orderTotal').toHaveText(value);
  }
}
```

---

## Running against different environments

Nothing in the test code knows which environment it is running against.
`config/environments.ts` is the one place that answers "what does `staging`
mean", and `TEST_ENV` selects it.

```bash
npm test                        # local (the default)
TEST_ENV=staging npm test       # staging
npm run test:staging            # same thing
TEST_ENV=prod npm test -- --grep @smoke
npx aiqa check --env staging    # the CLI takes --env too
npx aiqa envs                   # what is configured, and is it usable
```

### What an environment defines

```ts
staging: () => ({
  name: 'staging',
  label: 'Staging',
  baseURL: process.env.BASE_URL ?? 'https://staging.app.test/',
  apiURL: process.env.API_URL ?? 'https://api.staging.app.test/',

  readOnly: false,        // may this environment be written to?
  timeoutFactor: 2,       // shared environments are slower than localhost
  features: { promoCodes: true, newCheckout: false },

  users: {
    standard: lazyUser('STAGING_USER', 'STAGING_PASSWORD', 'QA User'),
    admin: lazyUser('STAGING_ADMIN_USER', 'STAGING_ADMIN_PASSWORD', 'QA Admin'),
  },

  extraHTTPHeaders: process.env.STAGING_BYPASS_TOKEN
    ? { 'x-vercel-protection-bypass': process.env.STAGING_BYPASS_TOKEN }
    : undefined,
}),
```

| Field | Effect |
| --- | --- |
| `baseURL` | `use.baseURL`. A missing trailing slash is added automatically. |
| `apiURL` | Root for API seeding. Omit it and API seeding reports itself unavailable rather than failing obscurely. |
| `readOnly` | Hard guard: the seeder refuses to create, update or delete. |
| `timeoutFactor` | Multiplies every timeout in `playwright.config.ts`. |
| `features` | Flags a test can branch on via the `env` fixture. |
| `users` | Roles for the `auth` setup project. Secrets resolve lazily. |
| `extraHTTPHeaders` | Sent on every request: WAF bypass, tenant pinning, tracing. |
| `ignoreHTTPSErrors` | For ephemeral environments with self-signed certs. |

Four are defined out of the box — `local`, `dev`, `staging`, `prod`. Add your
own by adding a key to the registry.

### Three things this gets right

**The trailing-slash trap.** `new URL('/cart', 'https://app.test/shop')`
returns `https://app.test/cart` — the base path is silently discarded. This is
the single most common cause of "works locally, 404s in staging". `baseURL` is
normalised to end with a slash on the way in.

**Secrets are read lazily.** Credentials are getters, not values. Running
against `local` never touches a staging password, so a developer without
staging secrets is not blocked. When one *is* missing, the error names the
variable and the file it belongs in:

```
Missing required environment variable "STAGING_USER".
  It is needed by the "staging" environment.
  Set it in .env.staging (gitignored) or in your CI secrets.
```

**Env-file order.** `.env.<TEST_ENV>` is loaded before `.env`, and dotenv never
overwrites a variable that is already set. The precedence is therefore:

```
real environment (CI secrets)  >  .env.staging  >  .env
```

CI always beats a file on disk, and the environment-specific file always beats
the shared one. `.env*` is gitignored except the `.example` files.

### Secrets

```bash
cp .env.staging.example .env.staging   # then fill it in; it is gitignored
```

In CI, set them as repository secrets instead — the same code reads both,
because real environment variables take precedence.

### Authentication per environment and role

Environments that declare `users` get an `auth` setup project automatically.
It signs each role in once per run and saves its storage state to
`.auth/<env>-<role>.json`; every browser project declares
`dependencies: ['auth']` and starts already signed in. No test spends time on
a login form it is not testing.

A test that needs a different role overrides it:

```ts
import { storageStatePath } from '../../config/environments.js';

test.describe('admin area', () => {
  test.use({ storageState: storageStatePath('staging', 'admin') });

  test('can see the audit log', async ({ ui }) => { /* ... */ });
});
```

Environments with no users (the local demo) get no setup project at all, which
is why this repository runs with zero configuration.

### Environment-specific expectations

Branch on a flag rather than forking the spec:

```ts
test('checkout', async ({ ui, env }) => {
  if (env.features.newCheckout) {
    await ui.expect('checkout.expressPanel').toBeVisible();
  } else {
    await ui.expect('checkout.legacyForm').toBeVisible();
  }
});
```

Skip a test that genuinely cannot run somewhere, and say why:

```ts
test('refunds an order', async ({ env }) => {
  test.skip(env.readOnly, `"${env.name}" is read-only; refunding creates real data`);
  // ...
});
```

Tag production-safe tests so the nightly prod job can select them. A `@smoke`
test must be genuinely read-only — it creates nothing and asserts only what is
safe to assert against live data:

```ts
test('the application loads and is usable @smoke', async ({ ui }) => {
  await ui.expect('todo.heading').toBeVisible();
  await ui.expect('todo.newTodoInput').toBeEnabled();
});
```

```bash
TEST_ENV=prod npx playwright test --grep @smoke
npm run test:prod                                  # same thing
```

### `npx aiqa envs`

Shows everything configured, and whether it would actually work right now:

```
  Environments (current: local)

  * local     Local / demo
      baseURL   https://demo.playwright.dev/todomvc/
      writes    allowed   timeouts x1
      features  promoCodes=true newCheckout=true
      users     (none — no auth setup project)
      dataset   ok (3 seed todo(s), promo "SAVE10")

    staging   Staging
      baseURL   https://staging.app.test/
      apiURL    https://api.staging.app.test/
      writes    allowed   timeouts x2
      features  promoCodes=true newCheckout=false
      users     standard: MISSING SECRET  admin: MISSING SECRET
      dataset   ok (3 seed todo(s), promo "STAGINGSAVE10")

    prod      Production (read-only)
      baseURL   https://app.test/
      writes    BLOCKED (readOnly)   timeouts x2
```

`MISSING SECRET` tells you what a run would be missing without running it.

Every run also prints what it resolved, so a report is never ambiguous about
where it ran:

```
  environment  Local / demo (local)
  baseURL      https://demo.playwright.dev/todomvc/
  writable     yes
  run id       rmukvf3by-d06a
```

---

## Test data

There are two kinds of test data, and conflating them is the usual reason a
suite only passes in one environment.

| | Reference data | Test-owned data |
| --- | --- | --- |
| What | Already exists in the environment | Created by the test, for the test |
| Examples | A known SKU, a seeded promo code, a search term with predictable results | A new user, a new order, three todos |
| Differs per environment | yes | no — it is generated |
| Where | `data/default.json` + `data/<env>.json` | `data.*` factories |
| Fixture | `dataset` | `data`, `seed`, `state` |

### Reference data — the `dataset` fixture

`data/default.json` holds the shape; `data/<env>.json` overrides only the keys
that genuinely differ.

```jsonc
// data/default.json
{
  "checkout": {
    "validPromoCode": "SAVE10",
    "expiredPromoCode": "EXPIRED2020",
    "expectedDiscountPercent": 10
  }
}

// data/staging.json — only the difference
{
  "checkout": { "validPromoCode": "STAGINGSAVE10" }
}
```

```ts
test('applies the promo code', async ({ ui, dataset }) => {
  await ui.fill('cart.promoInput', dataset.checkout.validPromoCode);
  await ui.click('cart.applyPromoButton');
  await ui.expect('cart.discountRow').toContainText(
    `${dataset.checkout.expectedDiscountPercent}%`,
  );
});
```

The merged result is validated against `datasetSchema` (`src/data/dataset.ts`)
in `global-setup.ts`, so a typo fails **once, at startup, with a path**:

```
Dataset for environment "staging" is invalid:
    - checkout.expectedDiscountPercent: Expected number, received string
  Fix data/default.json or data/staging.json, or update datasetSchema.
```

Extend `datasetSchema` as your app grows — every field you add becomes
type-safe and autocompleted in tests, and any environment missing it fails at
load time rather than as a confusing assertion twenty steps in.

### Test-owned data — the `data` factories

```ts
const todo  = data.todo({ completed: true });   // this test is about completion
const user  = data.user({ role: 'admin' });
const order = data.order({ items: [{ sku: 'SKU-9', quantity: 2 }] });
const many  = data.todos(25);                   // for pagination
```

Every generated value carries the **run tag**:

```
[qa:rmukvf3by-d06a] todo-rmukvf3by-d06a-w2-7
qa+rmukvf3by-d06a-w2-8@example.com
```

That one convention solves three problems at once:

- **Collision** — parallel workers and two concurrent CI jobs against the same
  shared environment cannot produce the same record. The tag includes the
  worker index.
- **Attribution** — anything left behind in staging says which run made it.
- **Cleanup** — a sweeper can delete everything matching an old run tag, even
  after the run that created it crashed.

The run id is fixed once in `global-setup.ts` and inherited by every worker.

### Getting the app into the right state

Three ways, in order of preference.

**1. Seed app state directly — the `state` fixture.** Instant, and it keeps the
test about the one thing it is testing.

```ts
test('filters completed todos', async ({ ui, state, data }) => {
  const todos = [
    data.todo({ title: 'active one' }),
    data.todo({ title: 'already done', completed: true }),
  ];

  await seedTodos(state, todos);   // localStorage, before the app boots
  await ui.goto('#/');

  await ui.click('todo.filterCompleted');
  await ui.expect('todo.todoTitles').toHaveText(['already done']);
});
```

`AppState` also offers `presetSessionStorage`, `setLocalStorageAndReload`,
`readLocalStorage`, `setCookies`, `setFlagCookie`, `clearStorage`, `stub` and
`failRequests`.

Ordering matters: `presetLocalStorage` uses `addInitScript` and must be called
**before** `goto`, because a client-rendered app reads storage once at boot.
Use `setLocalStorageAndReload` when the page is already open.

Each app owns one small adapter that knows its storage contract — `seedTodos`
in `src/data/app-state.ts` is the worked example. Tests never touch storage
keys directly.

**2. Seed over the API — the `seed` fixture.** For anything the backend owns.

```ts
test('shows the order in the history', async ({ ui, seed, data, env }) => {
  test.skip(!env.apiURL, 'this environment has no API to seed against');

  const order = await seed.create<{ id: string }>('orders', data.order());

  await ui.goto(`/orders/${order.id}`);
  await ui.expect('order.statusBadge').toHaveText('Pending');

  // No cleanup code: the fixture deletes it in teardown, even if this fails.
});
```

| Method | Purpose |
| --- | --- |
| `seed.create(resource, body, { idField, remove })` | Create and register for cleanup. |
| `seed.track(resource, id, remove?)` | Register something created elsewhere. |
| `seed.get` / `patch` / `remove` | Ordinary API calls. |
| `seed.pending` | How many entities are outstanding. |

Cleanup runs in **reverse order** — children before parents, which is what
referential integrity requires — and **never throws**. A cleanup failure must
not turn a passing test red or mask a real failure, so it logs loudly with the
run tag instead:

```
! [seed] cleanup left 1 entity behind in "staging" tagged [qa:rmukvf3by-d06a]:
    orders/8812 -> 409
```

#### These guarantees are tested, not just claimed

`local` ships with a small in-memory REST API (`tools/fixture-api.mjs`, started
automatically by `playwright.config.ts`), so `tests/e2e/api-seeding.spec.ts`
exercises the whole path over real HTTP:

| Test | Guarantee |
| --- | --- |
| creates fixture data over the API | create returns the entity and registers it |
| reads, updates and deletes | the full `get` / `patch` / `remove` surface |
| cleans up everything, newest first | deletion order is asserted against the API's own audit log |
| treats a 404 during cleanup as success | someone else removing it first is not a failure |
| cleanup never throws | a broken teardown cannot mask the test's real result |
| refuses to write to a readOnly environment | and never reaches the API |
| explains itself with no `apiURL` | `NoApiConfiguredError`, with what to do about it |
| surfaces status and body on rejection | errors say what the API actually said |

When you point the framework at your own application, replace `local.apiURL`
in `config/environments.ts` and delete `tools/fixture-api.mjs`.

**Each of those tests uses its own resource collection.** The fixture API is a
single shared server and the tests run in parallel, so a shared `todos`
collection would make each test's view of "what exists" depend on its
neighbours — the classic bug that passes alone and fails in CI. Namespacing
fixture data is the same discipline the run tag applies everywhere else.

**3. Drive the UI.** Only when getting there *is* the thing under test.

### Stubbing

```ts
await state.stub('**/api/orders', { status: 503, json: { error: 'maintenance' } });
await state.failRequests('**/api/slow');
```

Use it deliberately: a stubbed E2E test no longer proves the integration works.
It is the right tool for states a real backend cannot easily produce — a 500, a
timeout, an empty result set, a rate limit.

One gotcha worth knowing: `page.route` intercepts requests made *by the page*.
Requests made through `page.request` (an `APIRequestContext`) bypass it, which
is the usual reason a stub appears not to work.

### Never write to production

`prod` is `readOnly: true`, so the seeder refuses:

```
Refusing to create orders in "prod" — it is marked readOnly.
  Read-only environments are never seeded or mutated by tests.
  If this test needs fixture data, it must not run against prod:
  guard it with `test.skip(env.readOnly, '...')`.
```

Mark any shared environment you do not own the same way.

---

## Command reference

`npx aiqa <command>` works straight from a clone — no build step. Every
command also has an npm script (`npm run aiqa:audit`, …).

Every command accepts `--env <name>` (or `TEST_ENV=<name>`), which selects the
entry in `config/environments.ts` and therefore the base URL, the users, the
feature flags and which `.env.<name>` file wins.

```
aiqa scan <url>              Build a YAML locator file from a live page
aiqa gen "<goal>" --url …    Explore an app and generate a spec + locators
aiqa check --env …           Probe every locator against a live environment
aiqa envs                    List the configured environments and their health
aiqa audit                   Static quality review of the locator repository
aiqa list                    Show every locator the repository knows about
aiqa explain                 Re-run AI failure analysis from saved artifacts
aiqa migrate                 Convert an existing Selenium/Java suite (incl. BDD)
aiqa doctor                  Check the environment and configuration
aiqa help                    Full usage
```

### `aiqa doctor`

Environment smoke check. Run it first when anything behaves oddly.

```bash
npx aiqa doctor
```

```
  ok    Node                   v26.0.0
  ok    Locators dir           /repo/locators
  ok    Locators loaded        16 element(s)
  warn  Anthropic credentials  missing — AI tiers disabled; fallbacks and the heuristic matcher still work
  ok    AI model               claude-opus-5
  ok    Healing                on (persist: true)
  ok    Failure analysis       off
  ok    Chromium               153.0.8010.12
```

Exit code `0` unless the locator files fail to parse or browsers are missing.
Missing credentials is a **warning**, not a failure — the deterministic tiers
work without them.

### `aiqa list`

Everything the repository knows, grouped by namespace.

```bash
npx aiqa list
npx aiqa list --json        # machine-readable: key, file, locator, description
```

| Flag | Meaning |
| --- | --- |
| `--json` | Emit JSON instead of the grouped listing. |

### `aiqa envs`

Lists every environment in `config/environments.ts`, with its URLs, feature
flags, whether writes are allowed, whether its secrets are present, and
whether its dataset is valid. See
[Running against different environments](#running-against-different-environments)
for example output.

```bash
npx aiqa envs
```

### `aiqa audit`

Static quality review — no browser, no AI, no network. Encodes the rules this
framework says make a durable locator.

```bash
npx aiqa audit
```

Checks for: XPath selectors; generated class names (`css-1x2y3z`,
`ng-tns-c12`); deep `:nth-of-type` chains; structural selectors on generic
elements; text matches that look dynamic (dates, counts, currency); missing
`description`; no test id or role *and* no fallbacks; duplicate definitions;
and previously healed elements awaiting confirmation.

```
  Locator audit — 16 element(s) across 2 file(s)

  [HIGH  ] checkout.payNow
             selector depends on a generated class: ".css-1x2y3z"
  [MEDIUM] cart.promoInput
             no description — AI healing has no intent to match against

  2 issue(s), 1 high severity.
```

Exit code `1` when any HIGH severity issue exists — suitable as a CI gate.

### `aiqa check`

Probe every locator against a live environment. This is what turns healing
from a runtime rescue into a maintenance tool: run it against staging after a
UI release and fix the repository *before* a single test fails.

```bash
npx aiqa check --env staging
npx aiqa check --env staging --fix
npx aiqa check --env staging --only checkout --headed
npx aiqa check --base-url https://pr-42.preview.app.test/   # ad-hoc URL
```

| Flag | Meaning |
| --- | --- |
| `--env <name>` | Environment from `config/environments.ts`. Also honours `TEST_ENV`. |
| `--base-url <url>` | An explicit URL, overriding `--env`. Useful for preview deployments. |
| `--only <ns>` | Restrict to one namespace. |
| `--fix` | Write drifted locators back into the YAML. |
| `--headed` | Show the browser. |
| `--storage-state <file>` | Reuse a saved Playwright auth state. |

Elements are grouped by `(meta.url, meta.state)` so each page is visited once,
in a fresh browser context.

```
  DRIFTED  todoDrift.newTodoInput
           locator('#new-todo-input-v2-renamed') -> getByRole('textbox', { name: 'What needs to be done?' }) (82%)
  BROKEN   todoDrift.clearCompleted
           no unambiguous match for getByRole('button', { name: 'Remove finished items' })
           — best candidate <button> role=button name="Clear completed" scored 0.45
  BROKEN   todoDrift.ghostWidget
           not present on this page: getByTestId('fx-conversion-widget')

  10 ok · 4 drifted · 2 broken · 0 skipped
```

Note the honesty of the middle case: a plausible match that is not clearly the
right one is reported, never silently applied. `BROKEN` distinguishes "not on
this page" from "ambiguous" — different problems with different fixes.

Exit code `1` when anything is `BROKEN`.

**Preconditions.** Many elements only exist in a particular state. Declare
`meta.state` and implement it in `aiqa.setup.ts`:

```ts
// aiqa.setup.ts
import type { Page } from '@playwright/test';

const setup: Record<string, (page: Page) => Promise<void>> = {
  seeded: async (page) => {
    const input = page.getByPlaceholder('What needs to be done?');
    await input.fill('probe item');
    await input.press('Enter');
  },
  loggedIn: async (page) => {
    await page.getByLabel('Email').fill(process.env.TEST_USER!);
    await page.getByLabel('Password').fill(process.env.TEST_PASSWORD!);
    await page.getByRole('button', { name: 'Sign in' }).click();
  },
};

export default setup;
```

### `aiqa scan`

Turn a live page into a YAML locator file.

```bash
npx aiqa scan https://app.test/checkout --name checkout
npx aiqa scan https://app.test/checkout --no-ai              # offline, free
npx aiqa scan https://app.test/app --scope "#main" --headed
npx aiqa scan https://app.test/orders --storage-state .auth/user.json
```

| Flag | Meaning |
| --- | --- |
| `--name <ns>` | Locator namespace. Default: inferred from the URL. |
| `--out <file>` | Output path. Default: `locators/<name>.locators.yml`. |
| `--scope <css>` | Limit the scan to one region of the page. |
| `--wait-for <css>` | Wait for this selector before capturing (SPA hydration). |
| `--storage-state <file>` | Reuse a saved auth state. |
| `--headed` | Show the browser. |
| `--no-ai` | Deterministic extraction only — offline and free. |

With AI, elements are named for their role in the user journey and get the
descriptions that drive later healing. With `--no-ai`, names derive from
accessible names and test ids: less elegant, free, and works offline.

An existing file is backed up to `.bak` before being replaced.

### `aiqa gen`

Natural language to a runnable test.

```bash
npx aiqa gen "add two items to the cart and apply a promo code" \
  --url https://app.test --headed
```

| Flag | Meaning |
| --- | --- |
| `--url <url>` | Starting URL. **Required.** |
| `--name <ns>` | Locator namespace for generated elements. |
| `--out <dir>` | Spec output directory. Default: `tests/e2e`. |
| `--max-steps <n>` | Cap on exploration actions. Default: 18. |
| `--storage-state <file>` | Reuse a saved auth state. |
| `--headed` | Watch the exploration happen. |

Two phases, deliberately separated:

1. **Explore.** The model drives a real browser through a bounded tool loop
   (`snapshot` / `navigate` / `click` / `fill` / `press` / `finish`). Every
   selector it uses must come from a live snapshot, so the journey it records
   is one that actually happened. Failed actions are returned as errors so it
   adapts instead of inventing.
2. **Write.** A single structured call turns that verified journey into a spec
   plus the locator YAML it depends on, in this framework's conventions.

Requires credentials. Generated tests are a starting point — review the
assertions before committing. Existing files are backed up to `.bak`.

### `aiqa migrate`

Convert an existing Selenium (Java) suite — plain TestNG/JUnit page objects
**or** Cucumber BDD — into this framework.

```bash
npx aiqa migrate --analyze                       # what is in there?
npx aiqa migrate                                 # drafts -> migration/output/
npx aiqa migrate --input ./legacy --out ./draft  # explicit paths
npx aiqa migrate --apply                         # install into the framework
npx aiqa migrate --url https://app.test/login    # meta.url for the locators
```

| Flag | Meaning |
| --- | --- |
| `--input <dir>` | Selenium sources. Default: `SELENIUM_PROJECT_PATH` from `.env` (error if neither is set). |
| `--out <dir>` | Draft output. Default: `migration/output`. |
| `--apply` | Also install into `locators/`, `tests/e2e/`, `src/pages/`. |
| `--url <url>` | `meta.url` for the generated locator files. |
| `--analyze` | Report what was found; write nothing. |

Nothing is written outside the output directory unless `--apply` is passed.
Existing files are backed up to `.bak` first.

```
  4 locator file(s), 3 spec(s), 3 page object(s)
  60% of statements translated automatically
  BDD: 4 scenario(s) from 1 feature file(s), 11/11 steps bound
  Report: migration/output/MIGRATION-REPORT.md
  Review the drafts, then re-run with --apply to install them.
```

See [Migrating from Selenium](#migrating-from-selenium) for what maps to what,
and `migration/README.md` for the full guide.

### `aiqa explain`

Re-run failure analysis from artifacts already on disk. Diagnose a CI failure
locally from the downloaded report, without re-running anything.

```bash
npx aiqa explain
npx aiqa explain --input ./downloaded-ci-artifacts
```

| Flag | Meaning |
| --- | --- |
| `--input <dir>` | Where to find `ai-diagnostics.json`. Default: `test-results`. |

Writes `.ai/report/analysis.md` and prints it. Requires credentials.

### npm scripts

| Script | Runs |
| --- | --- |
| `npm test` | `playwright test` against `TEST_ENV` (default `local`) |
| `npm run test:dev` / `test:staging` | The same suite against that environment |
| `npm run test:prod` | `@smoke`-tagged tests only, against read-only prod |
| `npm run test:headed` | With a visible browser |
| `npm run test:ui` | UI mode — watch, time travel, pick locators |
| `npm run test:debug` | Playwright Inspector (`PWDEBUG=1`) |
| `npm run test:heal` | Healing on, results written back to YAML |
| `npm run test:nohealing` | Healing off — see what actually breaks |
| `npm run test:seed` | Run the agent seed test, headed |
| `npm run report` | Open the HTML report |
| `npm run trace <file>` | Open a trace |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | Emit `dist/` |
| `npm run codegen` | Playwright's own recorder |
| `npm run agents:init` | Install/refresh the Playwright agents |
| `npm run install:browsers` | `playwright install --with-deps` |
| `npm run aiqa:*` | `doctor` · `envs` · `list` · `audit` · `check` · `scan` · `gen` · `migrate` · `explain` |

---

## Configuration reference

`aiqa.config.ts` holds framework defaults; environment variables override it.

Two configuration files, with different jobs:

| File | Owns |
| --- | --- |
| `config/environments.ts` | *Where* tests run: URLs, users, flags, `readOnly`, timeout scaling. |
| `aiqa.config.ts` | *How* the framework behaves: healing thresholds, AI model, capture. |

Env files load in this order, and dotenv never overwrites an already-set
variable, so precedence runs: **real environment (CI secrets) > `.env.<TEST_ENV>`
> `.env`**.

### `aiqa.config.ts`

| Key | Default | Meaning |
| --- | --- | --- |
| `locatorsDir` | `locators/` | Where `*.locators.yml` live. |
| `artifactsDir` | `.ai/` | Journals, caches, reports. |
| `testIdAttribute` | `data-testid` | **Must match `playwright.config.ts`.** |
| `heal.enabled` | `true` | Master switch. |
| `heal.persist` | `true` locally, `false` in CI | Write heals back to YAML. |
| `heal.minConfidence` | `0.7` | Floor for accepting an AI heal. |
| `heal.heuristicMinScore` | `0.45` | Floor for the deterministic tier. |
| `heal.persistMinConfidence` | `0.85` | Floor for writing back to YAML. |
| `heal.timeoutMs` | `45000` | Budget for one AI heal attempt. |
| `heal.maxPerRun` | `25` | Hard cap on AI heal calls per run. |
| `heal.cache` | `true` | Reuse a heal for the same element + page signature. |
| `heal.strict` | `false` | Fail any test that needed healing. |
| `analysis.enabled` | `false` locally, `true` in CI | AI root-cause analysis. |
| `analysis.maxFailures` | `10` | Cap on analysed failures per run. |
| `ai.model` | `claude-opus-5` | Model for healing, scan, gen, analysis. |
| `ai.fastModel` | `claude-haiku-4-5` | Reserved for high-volume, low-judgement work. |
| `ai.effort` | `medium` | `low` … `max`. |
| `ai.maxTokens` | `8000` | Response cap. |
| `ai.maxSnapshotChars` | `60000` | Ceiling on DOM sent per request. |
| `capture.console` | `true` | Capture console warnings and errors. |
| `capture.network` | `true` | Capture network activity. |
| `capture.networkFailuresOnly` | `true` | Only 4xx/5xx/failed requests. |

### Environment variables

| Variable | Purpose |
| --- | --- |
| `TEST_ENV` | Which environment to run against. Default `local`. See `npx aiqa envs`. |
| `ANTHROPIC_API_KEY` | Credentials. Or run `ant auth login` — the SDK finds the profile. |
| `BASE_URL` | Overrides the environment's `baseURL`. Prefer `TEST_ENV`. |
| `API_URL` | Overrides the environment's `apiURL`. |
| `WEB_SERVER_COMMAND` | If set, Playwright starts this server before the run. |
| `AI_HEAL` | `on`/`off` — master switch. |
| `AI_HEAL_PERSIST` | `on`/`off` — write heals back to YAML. |
| `AI_HEAL_STRICT` | `on` — fail any test that needed healing (drift gate). |
| `AI_HEAL_CACHE` | `on`/`off` — heal cache. |
| `AI_HEAL_MIN_CONFIDENCE` | Floor for the AI tier. Default `0.7`. |
| `AI_HEAL_MIN_SCORE` | Floor for the deterministic tier. Default `0.45`. |
| `AI_HEAL_MAX_PER_RUN` | Cap on AI heal calls. Default `25`. |
| `AI_ANALYSIS` | `on`/`off` — AI root-cause analysis. |
| `AI_MODEL` / `AI_FAST_MODEL` | Model overrides. |
| `AI_EFFORT` | `low` … `max`. |
| `AI_LOCATORS_DIR` | Override the locators directory. |
| `AI_TEST_ID_ATTRIBUTE` | Override the test-id attribute. |
| `AI_LOG_LEVEL` | `silent` · `error` · `warn` · `info` · `debug`. |

### Cost control

The deterministic tiers handle the common cases; the system prompt is cached
across calls; heals are cached per element + page structure; `maxPerRun` is a
hard ceiling. Every run prints what it spent:

```
  AI usage: 3 call(s), 18420 in, 640 out, 16100 cached
```

Without credentials the framework degrades cleanly — fallbacks, the heuristic
matcher, `aiqa check`, `aiqa audit`, `aiqa list` and `aiqa scan --no-ai` all
keep working.

---

## Debugging a failure

Every failure arrives fully equipped, so nobody has to reproduce it:

| Artifact | Where |
| --- | --- |
| Trace (DOM, network, console, time travel) | `test-results/**/trace.zip` |
| Video and failure screenshot | `test-results/**` |
| Console errors + failed requests | `ai-diagnostics.md` attachment |
| Accessibility snapshot at the moment of failure | `ai-diagnostics.json` |
| Locators healed during the test | report annotation + attachment |
| AI root-cause analysis | `.ai/report/analysis.md` |

```bash
npm run test:ui                       # watch, time travel, pick locators
npm run test:debug                    # Playwright Inspector
npm run trace test-results/…/trace.zip
npx aiqa explain                      # analyse a CI bundle offline
```

The analyser is deliberately opinionated about one distinction: **`app-bug`
(the application is wrong — file a defect) versus `test-bug` (the test is
wrong)**. Getting that wrong wastes a developer's day, so it is asked to choose
deliberately, quote its evidence, and lower its confidence rather than invent a
plausible story. Other categories: `locator-drift`, `timing`, `environment`,
`data`, `network`, `unknown`.

Because analysis runs in the reporter from saved artifacts, it costs no test
wall-clock and can be re-run later.

---

## Migrating from Selenium

`migration/` converts an existing Selenium (Java) suite into this framework —
plain TestNG/JUnit page objects **and** Cucumber BDD.

```bash
echo "SELENIUM_PROJECT_PATH=/path/to/your/selenium-project" >> .env   # or edit .env
npx aiqa migrate --analyze     # what is in there?
npx aiqa migrate               # drafts -> migration/output/
npx aiqa migrate --apply       # install into locators/, tests/e2e/, src/pages/
```

Nothing is written outside `migration/output/` until you pass `--apply`.

| Source | Becomes |
| --- | --- |
| `@FindBy` / `By` fields | `locators/<ns>.locators.yml` |
| Page-object classes | `src/pages/<ns>.page.ts` (behaviour only) |
| Getters (`return el.getText()`) | typed accessors |
| TestNG / JUnit 4 / JUnit 5 classes | `tests/e2e/<ns>.spec.ts` |
| `.feature` files | one spec per feature |
| Scenario → `test`, Given/When/Then → `test.step` | the Gherkin structure survives |
| Background → `beforeEach`, Outline row → its own test | as Cucumber runs them |
| `@Test(groups)`, `@Tag`, feature/scenario tags | Playwright tags |

**Locators are upgraded only where the upgrade is provably equivalent** —
`linkText` → `getByRole('link', { name })`, `//*[@data-testid='x']` →
`getByTestId('x')`, `//button[text()='Save']` → `getByRole('button', …)`.
Everything else is translated literally, flagged in the report, and the
original is kept as a `fallback` so the migration is reversible.

**Nothing is guessed.** `Thread.sleep`, `JavascriptExecutor`, `Actions`,
frame/window switching and implicit waits become `TODO(migration)` comments
carrying the original Java and what they should become. Unbound Gherkin steps
become tests that *throw*, so they fail loudly rather than passing vacuously.

`migration/output/MIGRATION-REPORT.md` is the work list: coverage, locators
worth rewriting with the original selector and why, unbound steps, and a
per-file table. See `migration/README.md` for the full guide, and
`migration/examples/selenium-java/` for a worked example you can run the
converter against.

---

## Skills

`.claude/skills/` carries the framework's operating knowledge as task-scoped
Claude Code skills. They trigger automatically from what you ask, so an agent
starts working immediately instead of re-deriving the conventions from source
every session.

| Skill | Triggers on | Contains |
| --- | --- | --- |
| `aiqa-write-test` | add or refactor a test, cover a journey, page objects | House style, every fixture, the `ui` surface, the hard rules |
| `aiqa-locators` | locators, selectors, element-not-found, ambiguous match | The complete YAML schema, strategy preference, error decoding |
| `aiqa-debug-failure` | a failing, flaky or timing-out test; triage | Artifact map, triage order, app-bug vs test-bug, flake isolation |
| `aiqa-environments` | staging/prod, `TEST_ENV`, secrets, auth, test data | Environment registry, the two kinds of data, seeding order, guards |
| `aiqa-healing` | healing, drift, thresholds, reviewing healed YAML | The cascade, every threshold, the safeguards, drift workflow |
| `aiqa-migrate-selenium` | Selenium, TestNG/JUnit, Cucumber, `@FindBy`, `.feature` files | The command, the mapping tables, the review workflow |

`CLAUDE.md` stays the short always-loaded contract; the skills hold the
detail and load only when relevant. Together with the agents below:

```
CLAUDE.md        always loaded — the binding conventions
.claude/skills/  loaded on demand — how to do one kind of task
.claude/agents/  delegated work — planner, generator, healer, curator
```

Edit a skill when a convention changes. Unlike `.claude/agents/playwright-test-*.md`,
skills are yours and are never regenerated.

---

## Playwright Agents

`npm run agents:init` installs Playwright's own planner / generator / healer
agents (`npx playwright init-agents --loop=claude`) alongside this framework's
curator agent.

| Agent | Role | Output |
| --- | --- | --- |
| `playwright-test-planner` | Explores the app, writes a Markdown test plan | `specs/*.md` |
| `playwright-test-generator` | Turns a plan into a runnable spec | `tests/*.spec.ts` |
| `playwright-test-healer` | Runs a suite and repairs failing **tests** | patched specs |
| `aiqa-locator-curator` | Lifts inline selectors into YAML, rewrites the spec in house style | `locators/*.yml` + spec |

The typical loop:

```
planner   →  specs/checkout.md
generator →  tests/checkout.spec.ts          (plain Playwright)
curator   →  locators/checkout.locators.yml  + framework-style spec
healer    →  fixes waits, flow and assertions when it breaks
```

`tests/seed.spec.ts` uses the framework fixtures because the generator mirrors
the seed — it is the most effective place to teach house style. `CLAUDE.md`
carries the conventions for every agent in the repo.

Do **not** edit `.claude/agents/playwright-test-*.md`: `init-agents`
regenerates them whenever Playwright is updated. Put guidance in `CLAUDE.md`.

### MCP servers

`.mcp.json` configures two:

- `playwright-test` — drives the Playwright test runner; used by the agents.
- `playwright` — general browser automation (`@playwright/mcp`, with the
  `testing`, `network` and `storage` capabilities enabled).

### Three kinds of healing, and why all three exist

| | Repairs | When |
| --- | --- | --- |
| Runtime healing | a **locator** | during a run, so the suite finishes |
| `aiqa check --fix` | the **repository** | before anything fails |
| `playwright-test-healer` | a **test** — waits, flow, assertions | when the test itself is wrong |

No locator strategy can fix a test that waits on the wrong thing; no test
healer should be rewriting selectors that belong in YAML.

---

## CI

`.github/workflows/e2e.yml` ships two jobs.

**`test`** — runs against `dev` for pull requests, `staging` for `main` and
the nightly, or whatever a manual run picks. Healing is on so a UI change
doesn't fail the whole suite, but persistence is off so drift is *reported*,
not silently absorbed. AI analysis writes into the GitHub job summary. Report,
traces and analysis upload as artifacts, named per environment.

Secrets are passed as environment variables, which take precedence over any
`.env` file — the same code works locally and in CI with no branching.

**`locator-drift`** — nightly `aiqa check` plus `aiqa audit` against the
environment. Informational by design: it tells you the repository has drifted
before a suite starts relying on healing to stay green.

**`prod-smoke`** — nightly, `TEST_ENV=prod`, `--grep @smoke`. Because `prod`
is `readOnly` in the registry, any test that tries to seed fixture data fails
loudly instead of creating real records.

To make drift a hard gate, add a job running with `AI_HEAL_STRICT=on`: any
test that only passed because it healed will fail.

---

## Recipes

**Add a new page.**

```bash
npx aiqa scan https://app.test/settings --name settings
$EDITOR locators/settings.locators.yml     # sharpen the descriptions
npx aiqa audit
```

**A UI release just landed.**

```bash
npx aiqa check --base-url https://staging.app.test          # see the damage
npx aiqa check --base-url https://staging.app.test --fix    # apply the clear ones
git diff locators/                                          # review every change
```

**A test is failing and you don't know why.**

```bash
npm test -- tests/e2e/checkout.spec.ts
npm run trace test-results/…/trace.zip
AI_ANALYSIS=on npx aiqa explain
```

**Find out how much healing is propping up the suite.**

```bash
npm run test:nohealing          # what actually breaks
AI_HEAL_STRICT=on npm test      # fail anything that only passed by healing
```

**Authenticate once and reuse it.**

```bash
npx playwright codegen --save-storage=.auth/user.json https://app.test/login
npx aiqa scan https://app.test/orders --storage-state .auth/user.json
npx aiqa check --base-url https://app.test --storage-state .auth/user.json
```

**Point the suite at a preview deployment.**

```bash
BASE_URL=https://pr-42.preview.app.test/ TEST_ENV=staging npm test
npx aiqa check --base-url https://pr-42.preview.app.test/
```

**Add a new environment.** Add a key to the registry in
`config/environments.ts`, then:

```bash
cp .env.staging.example .env.qa2    # fill in its secrets
npx aiqa envs                       # confirm it resolves and secrets are present
TEST_ENV=qa2 npx aiqa check         # confirm the locators exist there
TEST_ENV=qa2 npm test
```

**A test needs data that only exists in staging.** Put it in
`data/staging.json` and read it through `dataset` — never hardcode it in the
spec, or the test will only ever pass in one place.

**Find what a crashed run left behind.** Every generated value carries its run
tag, so search your database or admin UI for `[qa:` — or for a specific run id
printed in that run's output.

**Migrate an existing Selenium suite.**

```bash
# set SELENIUM_PROJECT_PATH in .env (or pass --input)
npx aiqa migrate --analyze      # sanity-check what was found
npx aiqa migrate                # drafts + MIGRATION-REPORT.md
$EDITOR migration/output/MIGRATION-REPORT.md
npx aiqa migrate --apply        # install the reviewed drafts
npx tsc --noEmit && npx aiqa audit && npm test
```

Then work the `TODO(migration)` markers and the report's "Worth rewriting"
list. Try it on the bundled example first:

```bash
npx aiqa migrate --input migration/examples/selenium-java
```

**Work entirely offline.** Everything except `gen`, the AI heal tier and
`explain` works with no credentials: `scan --no-ai`, `check`, `audit`, `list`,
`doctor`, and the deterministic healing tiers.
