---
name: aiqa-write-test
description: Write, extend or refactor a Playwright test in this framework. Use whenever the request is to add a test, cover a user journey or scenario, convert a manual test case into an automated one, turn a spec/plan into a spec file, add a page object, or clean up an existing test. Also use when a test contains inline selectors, waitForTimeout, or imports from '@playwright/test' directly. Contains the full house style so the project does not need re-exploring.
---

# Writing a test

Everything you need is here. Do not re-read the framework source to answer
questions this file already answers.

## The one rule

**No selector ever appears in a spec.** Elements are declared in
`locators/<namespace>.locators.yml` and referenced by key. A test containing
`page.locator('.btn')` is wrong even if it passes — it defeats healing,
auditing and regeneration.

## Skeleton

```ts
import { test, expect } from '../../src/fixtures/index.js';

test.describe('Checkout', () => {
  test.beforeEach(async ({ ui }) => {
    await ui.goto('/cart');
  });

  test('applies a promo code', async ({ ui, dataset }) => {
    await test.step('apply the code', async () => {
      await ui.fill('cart.promoInput', dataset.checkout.validPromoCode);
      await ui.click('cart.applyPromoButton');
    });

    await ui.expect('cart.discountRow').toBeVisible();
    await ui.expect('cart.orderTotal').toHaveText('$89.99');
  });
});
```

Specs live in `tests/e2e/*.spec.ts`. The import path from there is exactly
`../../src/fixtures/index.js` (keep the `.js` extension — this is ESM).

## Fixtures

| Fixture | What it is |
| --- | --- |
| `ui` | Actions + assertions keyed by locator name. Your main tool. |
| `find` | `(key, opts?) => Promise<Locator>` — raw resolution, already healed. |
| `locators` | The repository: `keys()`, `has(key)`, `get(key)`, `namespaces()`. |
| `heals` | `HealRecord[]` — what healed during this test. |
| `diagnostics` | Console/network buffers for this test. |
| `env` | Resolved environment: `name`, `baseURL`, `apiURL`, `features`, `readOnly`. |
| `dataset` | Reference data for this environment. |
| `data` | Factories for test-owned data (`data.todo()`, `data.user()`, …). |
| `state` | Seed storage/cookies directly, stub responses. |
| `seed` | Create fixture data over the API; auto-cleaned in teardown. |

Plus every built-in Playwright fixture (`page`, `context`, `request`, …).

## The `ui` surface

| Group | Methods |
| --- | --- |
| Navigate | `goto(path, { waitUntil })` |
| Act | `click` `dblclick` `fill` `type` `press` `check` `uncheck` `selectOption` `hover` `setInputFiles` `dragTo` |
| Query | `textOf` `valueOf` `count` `isVisible` `locator` |
| Assert | `expect(key).toBeVisible / toBeHidden / toBeEnabled / toBeDisabled / toBeChecked / toHaveText / toContainText / toHaveValue / toHaveCount / toHaveAttribute` |
| Page | `expectUrl` `expectTitle` `screenshot(name)` |

`ui.locator(key)` returns a plain healed `Locator` — the escape hatch for
anything not covered (`allInnerTexts()`, `.filter()`, `.nth()`, drag maths).

## Hard rules

1. Import from `src/fixtures/index.js`, never `@playwright/test`.
2. No inline selectors. If an element is missing from YAML, add it — see the
   `aiqa-locators` skill.
3. **Never** `waitForTimeout`, `page.waitForSelector` with a sleep, or
   `{ force: true }` to make something pass. `ui.expect(...)` retries.
4. Wrap logical phases in `test.step()` so the trace and report read as a test
   case.
5. One user journey per test. Shared setup in `beforeEach`.
6. Reference data comes from `dataset`, never hardcoded — a hardcoded SKU
   makes the test pass in exactly one environment.
7. Get to the screen under test by seeding state, not by clicking through it.
8. Tag genuinely read-only tests `@smoke` so the prod job can select them.

## Getting to the right state

In order of preference:

```ts
// 1. Seed app state — instant, no UI. Must precede goto().
await seedTodos(state, [data.todo({ completed: true })]);
await ui.goto('#/');

// 2. Seed over the API — cleaned up automatically in teardown.
const order = await seed.create<{ id: string }>('orders', data.order());

// 3. Drive the UI — only when getting there IS the thing under test.
```

Guard what cannot run somewhere, and say why:

```ts
test.skip(env.readOnly, `"${env.name}" is read-only; this test creates data`);
test.skip(!env.apiURL, 'this environment has no API to seed against');
```

See the `aiqa-environments` skill for the data model in full.

## Page objects

Behaviour only — never selectors. `src/pages/<name>.page.ts`:

```ts
import { BasePage } from './base.page.js';
import type { SmartPage } from '../fixtures/smart-page.js';

export class CartPage extends BasePage {
  constructor(ui: SmartPage) { super(ui, 'cart'); }   // 'cart' = namespace

  async applyPromo(code: string) {
    await this.fill('promoInput', code);              // -> cart.promoInput
    await this.click('applyPromoButton');
  }
}
```

Protected helpers available: `locator` `click` `fill` `type` `press` `check`
`uncheck` `select` `hover` `textOf` `valueOf` `countOf`, and public `expect`.
Override `open(path)` for a page that knows its own route.

Use a page object when a journey is reused across specs. A single-use flow is
fine inline.

## Before you finish

```bash
npx playwright test tests/e2e/<file>.spec.ts --project=chromium --reporter=list
npx tsc --noEmit
npx aiqa audit          # if you added or changed locators
```

Report what you ran and what it said. If a test fails after refactoring,
the refactor is wrong — never weaken an assertion to make it green.
