# ai-playwright-framework — conventions for agents

This repo is a Playwright E2E framework with a YAML locator repository and
AI-assisted healing, generation and debugging. These conventions are binding
for every agent working here, including the Playwright planner, generator and
healer agents in `.claude/agents/`.

## Skills — load these instead of re-reading the project

`.claude/skills/` holds task-scoped skills that carry the framework's
operating knowledge. They trigger automatically from the request. Load the
matching one **before** exploring source files — it already contains the
schema, the commands and the conventions you would otherwise go looking for.

| Skill | Triggers on |
| --- | --- |
| `aiqa-write-test` | add/write/refactor a test, cover a journey, page objects |
| `aiqa-locators` | locators, selectors, YAML elements, element-not-found, ambiguous match |
| `aiqa-debug-failure` | a failing/flaky/timing-out test, traces, triage, app-bug vs test-bug |
| `aiqa-environments` | staging/prod, TEST_ENV, secrets, auth state, test data, seeding |
| `aiqa-healing` | healing, drift, thresholds, persistHeals, reviewing healed YAML |
| `aiqa-migrate-selenium` | migrating Selenium/TestNG/JUnit/Cucumber suites into this framework |
| `aiqa-ksp-migration` | **any** KSP migration work: modules, DCX IDs, `tests/drafts`, `migrate:drafts` (strict procedure) |

This file stays the short, always-loaded contract; the skills hold the detail.

## Selenium migration

For any request to migrate a module, DCX IDs or a tag, load the
`aiqa-ksp-migration` skill and follow it step by step, and read
`docs/migration-playbook.md`, `docs/migration-framework-map.md`,
`docs/migration-tracker.md` and `docs/migration-drafts-report.md` first (STG
only, branch `develop_Sandeep`, Selenium read-only, settings and the
credentials path from `.env`). Every KSP scenario already exists as a
`test.fixme` draft in `tests/drafts/` — graduate drafts into `tests/e2e/`,
never un-fixme them in place, never hand-edit generated drafts.

## The one rule that matters

**No selector ever appears in a spec file.** Every element a test touches is
declared in `locators/<namespace>.locators.yml` and referenced by key
(`"todo.newTodoInput"`). That indirection is what makes auto-healing, auditing
and regeneration possible. A generated test containing `page.locator('.btn')`
is wrong even if it passes.

## Writing a test

```ts
import { test, expect } from '../../src/fixtures/index.js';

test('a user can check out', async ({ ui }) => {
  await ui.goto('/cart');
  await test.step('apply a discount', async () => {
    await ui.fill('cart.promoInput', 'SAVE10');
    await ui.click('cart.applyPromoButton');
  });
  await ui.expect('cart.orderTotal').toHaveText('$89.99');
});
```

- Import `test`/`expect` from `src/fixtures/index.js`, never `@playwright/test`.
- Drive the page through the `ui` fixture. `ui.locator(key)` is the escape
  hatch when an action is not covered.
- Assert with `ui.expect(key)` — these are Playwright's retrying web-first
  assertions. **Never use `waitForTimeout` or any manual sleep.**
- Name logical phases with `test.step()`.
- One user journey per test; shared setup in `beforeEach`.

## Declaring a locator

```yaml
meta:
  name: cart              # the namespace: `cart.promoInput`
  description: Shopping cart page
  url: /cart              # enables `aiqa check`
  # persistHeals: false   # heal at runtime but never rewrite this file

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
    multiple: true        # a collection; matching many is expected
```

Three levels of verbosity are accepted and normalised to the same thing:

| Form | Example |
| --- | --- |
| shorthand string | `submitButton: "#submit"` |
| inferred strategy | `submitButton: { role: button, name: Sign in }` |
| explicit chain | `steps: [{ strategy: role, role: row }, ...]` |

Strategy preference, in order: `testId` → `role`+`name` → `label` /
`placeholder` → `text` → `css`. XPath is a last resort. Never depend on
generated class names (`css-1x2y3z`, `ng-tns-c12`), deep `:nth-of-type`
chains, or text that is obviously dynamic (dates, counts, currency).

**`description` is not documentation.** It is the intent the healer matches
against when the selector stops resolving, so a vague description permanently
weakens the framework. Write what the element is *for*.

## Field reference

| Field | Meaning |
| --- | --- |
| `description` | Intent. Drives healing. Always write one. |
| `steps` | Resolution chain; each step narrows the previous. |
| `fallbacks` | Alternatives tried before any inference. |
| `filter` | `hasText` / `hasNotText` / `has` / `hasNot` / `visible`. |
| `index` | `first`, `last`, or a number. |
| `multiple` | This element is a collection; ambiguity is expected. |
| `frame` | Resolve inside this iframe first. |
| `heal` | `false` disables healing for this element. |
| `tags` | Free-form, surfaced by `aiqa audit`. |
| `healedAt` / `healedFrom` | Written by the framework. Do not hand-edit. |

## How the Playwright agents fit in

| Agent | Role | Output |
| --- | --- | --- |
| `playwright-test-planner` | Explores the app, writes a Markdown plan | `specs/*.md` |
| `playwright-test-generator` | Turns a plan into a runnable spec | `tests/*.spec.ts` |
| `playwright-test-healer` | Runs a suite and repairs failures | patched specs |

They are regenerated by `npx playwright init-agents --loop=claude`, so **do not
edit `.claude/agents/playwright-test-*.md`** — your changes will be lost. Put
guidance here in `CLAUDE.md` instead, which applies to all of them.

After the generator produces a spec, run the `aiqa-locator-curator` agent (or
do it by hand) to lift any inline selectors into YAML and rewrite the spec
against the `ui` fixture.

This framework's own healing is complementary to the Playwright healer agent:

- **Runtime healing** (`src/ai/healer.ts`) repairs a locator *during* a run so
  the suite finishes, and records what it did.
- **`aiqa check --fix`** repairs the whole repository against a live
  environment *before* anything fails.
- **`playwright-test-healer`** repairs a *test* — its waits, its assertions,
  its flow — not just its locators.

## Environments and test data

Nothing in a test knows which environment it runs against. `TEST_ENV` selects
an entry in `config/environments.ts`, which owns the base URL, the API URL,
the users, the feature flags, `readOnly` and the timeout scaling.

```bash
TEST_ENV=staging npm test
npx aiqa envs                 # what is configured, and is it usable
```

Two kinds of data, and they must not be confused:

- **Reference data** already exists in the environment (a known SKU, a seeded
  promo code). It lives in `data/default.json` + `data/<env>.json` and is read
  through the `dataset` fixture. **Never hardcode it in a spec** — the test
  will then only pass in one environment.
- **Test-owned data** is created by the test. Build it with the `data`
  factories, which tag every value with the run id so parallel workers and
  concurrent CI jobs cannot collide.

Get the app into the right state in this order of preference:

1. `state` fixture — seed storage/cookies directly. Instant, no UI.
2. `seed` fixture — create over the API. Cleaned up automatically in teardown.
3. Drive the UI — only when getting there *is* the thing under test.

Rules:
- Give fixture data its own namespace when the backing store is shared
  (`unique('todos')` as a resource name). Tests run in parallel.
- Guard tests that cannot run somewhere, and say why:
  `test.skip(env.readOnly, '...')`, `test.skip(!env.apiURL, '...')`.
- Tag genuinely read-only tests `@smoke` so the prod job can select them.
- Never add a secret to `config/environments.ts`. Secrets are read from the
  environment, lazily, via `lazyUser`.

## Commands

```bash
npm test                      # run the suite (TEST_ENV, default local)
npm run test:staging          # same suite against staging
npm run test:prod             # @smoke tests only, against read-only prod
npm run test:ui               # Playwright UI mode (watch + time travel)
npm run test:heal             # healing on, write results back to YAML
npx aiqa doctor               # environment check
npx aiqa envs                 # configured environments and their health
npx aiqa list                 # every locator the repository knows
npx aiqa audit                # static quality review of the locators
npx aiqa check --base-url ... # probe every locator against a live env
npx aiqa scan <url>           # build a locator file from a live page
npx aiqa gen "<goal>" --url … # explore an app and generate a spec
npx aiqa explain              # AI root-cause analysis of saved failures
```

## Things not to do

- Do not add `waitForTimeout`, `page.waitForSelector` with arbitrary sleeps,
  or `{ force: true }` to make a flaky test pass.
- Do not hand-edit `healedAt` / `healedFrom`.
- Do not commit `.ai/heal-journal.jsonl`, `.ai/heal-cache.json` or
  `.ai/report/` — they are run artifacts and are gitignored.
- Do not weaken an assertion to make a test green. If the app is wrong, say so.
