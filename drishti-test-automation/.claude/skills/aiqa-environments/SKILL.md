---
name: aiqa-environments
description: Run tests against a different environment, add a new one, or set up test data. Use when the request mentions dev/staging/prod/QA environments, TEST_ENV, base URL, environment variables, secrets, .env files, authentication or login state, feature flags, test data, fixture data, seeding, data cleanup, datasets, or "it passes locally but not in staging". Contains the environment registry and the data model so neither needs re-reading.
---

# Environments and test data

Nothing in a test knows which environment it runs against. `TEST_ENV` picks an
entry from `config/environments.ts`.

```bash
npm test                        # local (default)
TEST_ENV=staging npm test       # or: npm run test:staging
npm run test:prod               # @smoke only, against read-only prod
npx aiqa check --env staging    # the CLI takes --env too
npx aiqa envs                   # what is configured, and is it usable
```

## What an environment owns

`config/environments.ts`, registry keyed by name (`local`, `dev`, `staging`,
`prod` ship by default):

| Field | Effect |
| --- | --- |
| `baseURL` | `use.baseURL`. A missing trailing slash is added automatically. |
| `apiURL` | Root for API seeding. Omit → seeding reports itself unavailable. |
| `readOnly` | Hard guard: the seeder refuses to create/update/delete. |
| `timeoutFactor` | Multiplies every timeout in `playwright.config.ts`. |
| `features` | Flags a test branches on via the `env` fixture. |
| `users` | Roles for the `auth` setup project. Secrets resolve **lazily**. |
| `extraHTTPHeaders` | Sent on every request: WAF bypass, tenant pinning. |
| `ignoreHTTPSErrors` | For ephemeral envs with self-signed certs. |

Adding one: add a key to the registry, create `.env.<name>`, then
`npx aiqa envs` to confirm it resolves and its secrets are present.

## Three traps this already handles — do not re-solve them

1. **Trailing slash.** `new URL('/cart', 'https://app.test/shop')` drops the
   base path. `baseURL` is normalised on the way in.
2. **Lazy secrets.** Credentials are getters. Running `local` never touches a
   staging password. A missing one names the variable and the file.
3. **Env-file order.** `.env.<TEST_ENV>` loads before `.env`, and dotenv never
   overwrites, so precedence is **real env (CI secrets) > `.env.staging` >
   `.env`**. Never `import 'dotenv/config'` anywhere — use `loadEnvFiles()`.

## Secrets

Never put a secret in `config/environments.ts`. Declare it with `lazyUser`:

```ts
users: {
  standard: lazyUser('STAGING_USER', 'STAGING_PASSWORD', 'QA User'),
}
```

Local: `cp .env.staging.example .env.staging` (gitignored). CI: repository
secrets — real environment variables win over any file.

## Authentication

Environments with `users` get an `auth` setup project automatically: signs each
role in once per run, saves storage state to `.auth/<env>-<role>.json`, and
browser projects declare `dependencies: ['auth']`. No test logs in manually.

A test needing a different role:

```ts
import { storageStatePath } from '../../config/environments.js';

test.describe('admin area', () => {
  test.use({ storageState: storageStatePath('staging', 'admin') });
  test('sees the audit log', async ({ ui }) => { /* ... */ });
});
```

Environments with no users (the local demo) get no setup project, which is why
the repo runs with zero configuration.

## Two kinds of test data — never confuse them

| | Reference data | Test-owned data |
| --- | --- | --- |
| What | Already exists in the environment | Created by the test, for the test |
| Examples | A known SKU, a seeded promo code | A new user, order, three todos |
| Varies per env | **yes** | no — it is generated |
| Where | `data/default.json` + `data/<env>.json` | `data.*` factories |
| Fixture | `dataset` | `data`, `seed`, `state` |

**Hardcoding reference data in a spec is the single most common reason a suite
passes in one environment only.** Put it in the dataset.

### Reference data

```jsonc
// data/default.json
{ "checkout": { "validPromoCode": "SAVE10", "expectedDiscountPercent": 10 } }

// data/staging.json — only the difference
{ "checkout": { "validPromoCode": "STAGINGSAVE10" } }
```

```ts
await ui.fill('cart.promoInput', dataset.checkout.validPromoCode);
```

Deep-merged and validated against `datasetSchema` in `src/data/dataset.ts`,
checked once in `global-setup.ts`. Adding a field there makes it type-safe and
fails loudly in any environment that omits it.

### Test-owned data

```ts
const todo  = data.todo({ completed: true });
const user  = data.user({ role: 'admin' });
const order = data.order({ items: [{ sku: 'SKU-9', quantity: 2 }] });
const many  = data.todos(25);
```

Every generated value carries the run tag — `[qa:rmukvf3by-d06a]`, including
the worker index. That gives collision-freedom across parallel workers and
concurrent CI jobs, attribution for anything left behind, and sweepability.
The run id is fixed once in `global-setup.ts` and inherited by every worker.

## Getting the app into the right state

**1. Seed app state — the `state` fixture.** Instant, no UI.

```ts
await seedTodos(state, [data.todo({ completed: true })]);
await ui.goto('#/');     // presetLocalStorage MUST precede goto()
```

`AppState`: `presetLocalStorage` `presetSessionStorage`
`setLocalStorageAndReload` `readLocalStorage` `setCookies` `setFlagCookie`
`clearStorage` `stub` `failRequests`.

Each app owns one small adapter that knows its storage contract (`seedTodos`
in `src/data/app-state.ts` is the worked example). Tests never touch storage
keys directly.

**2. Seed over the API — the `seed` fixture.**

```ts
test.skip(!env.apiURL, 'this environment has no API to seed against');
const order = await seed.create<{ id: string }>('orders', data.order());
// no cleanup code: the fixture deletes it in teardown, even on failure
```

`seed.create(resource, body, { idField, remove })` · `seed.track` ·
`seed.get` / `patch` / `remove` · `seed.pending`.

Cleanup runs in **reverse order** (children before parents) and **never
throws** — a failing teardown must not mask the test's real result. Leftovers
are logged with the run tag.

**When the backing store is shared, give each test its own namespace**
(`unique('todos')` as the resource name). Tests run in parallel; a shared
collection couples them and produces the classic passes-alone-fails-in-CI bug.

**3. Drive the UI.** Only when getting there *is* the thing under test.

## Stubbing

```ts
await state.stub('**/api/orders', { status: 503, json: { error: 'maintenance' } });
await state.failRequests('**/api/slow');
```

Use deliberately: a stubbed E2E test no longer proves the integration works.
Right for a 500, a timeout, an empty result set, a rate limit.

Gotcha: `page.route` intercepts requests made *by the page*. Requests through
`page.request` (an `APIRequestContext`) bypass it — the usual reason a stub
appears not to work.

## Never write to production

`prod` is `readOnly: true`; the seeder refuses with an explanatory error. Mark
any shared environment you do not own the same way. Guard tests that need
data:

```ts
test.skip(env.readOnly, `"${env.name}" is read-only; this test creates data`);
```

Tag production-safe (creates nothing) tests `@smoke`.

## Branch on flags, don't fork the spec

```ts
if (env.features.newCheckout) {
  await ui.expect('checkout.expressPanel').toBeVisible();
} else {
  await ui.expect('checkout.legacyForm').toBeVisible();
}
```

## The bundled fixture API

`local.apiURL` points at `tools/fixture-api.mjs`, an in-memory REST server
started automatically by `playwright.config.ts`. It exists so the framework's
own seeding path is tested for real. When pointing this framework at your
application, replace `local.apiURL` and delete that file.
