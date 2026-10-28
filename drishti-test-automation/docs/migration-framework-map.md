# Migration framework map

Actual paths and conventions, verified in source. Re-verified for the shared
checkout below on commit `06cd10c` (branch `develop_Sandeep`). If `git log`
shows newer commits touching `playwright.config.ts`, `config/`, `src/fixtures/`
or `tests/auth.setup.ts`, re-verify the affected section before relying on it.

## Repositories

The **Playwright framework is the primary migration target**. The **Selenium
framework is the source framework and migration reference**; its location is
configured per developer with `SELENIUM_PROJECT_PATH` (below).

| | Path | Branch | Rule |
| --- | --- | --- | --- |
| Playwright target (git root) | `D:\Keysight_Playwright_migration\drishti-test-automation` | `develop_Sandeep` | All edits here, only on this branch. Never create or switch branches. |
| Selenium source (read-only) | Path supplied by each developer in `SELENIUM_PROJECT_PATH` (`.env`) | `drishti_develop` | **Read-only.** Not tracked by this repo. Before and after every task run `git -C $env:SELENIUM_PROJECT_PATH status --short` (after loading `.env`, or use the literal path) and confirm it is unchanged; any pre-existing local change (e.g. `SearchPage.java`) is not ours. |
| Credentials file (external) | Path supplied by each developer or execution environment in `CREDENTIALS_FILE` | n/a (outside the repo) | Local secrets. Never copy into the repo, print or commit. |

Playwright git commands do not see Selenium changes (separate repository); check
them with the `git -C` command above.

### `SELENIUM_PROJECT_PATH` — Selenium source location

One variable, one resolver (`src/migration/source-path.ts`), used by every
migration command: `aiqa migrate` (incl. `--analyze`) and
`npm run migrate:drafts`. Nothing else holds a path; there is no default
location and no fallback.

- **Configure:** in your local, gitignored `.env` (template: `.env.example`):
  `SELENIUM_PROJECT_PATH=<absolute path to your Selenium repository root>`.
- **Load:** the resolver calls `loadEnvFiles()` (the framework's single loader).
  Precedence: shell/CI variable > `.env.<TEST_ENV>` > `.env`; an empty value counts
  as unset. Files are read from the current directory, so **run from the
  repository root**.
- **Precedence vs CLI:** an explicit `--input <dir>` always wins over the
  variable. Neither set, or the path missing / not a directory -> exit code 1
  with an actionable message; nothing is written and no other repository is used.
- `migrate:drafts` accepts the Selenium repo root or its `src\test\java`.
- Jenkins sets `SELENIUM_PROJECT_PATH` to the checked-out dependency.

```powershell
# from the Playwright repository root, with SELENIUM_PROJECT_PATH set in .env
npx aiqa migrate --analyze                 # read-only inventory
npm run migrate:drafts -- --dry-run        # same source, writes nothing
npm run migrate:drafts                     # regenerate drafts
npm run migrate:drafts -- --input "D:\other\selenium-checkout" --dry-run   # override
# one-off shell override (wins over .env):
$env:SELENIUM_PROJECT_PATH = "D:\path\to\ksp-test-automation"
```

## Shared folder layout

| Area | Path | Contents / role |
| --- | --- | --- |
| Selenium source (read-only) | `$SELENIUM_PROJECT_PATH` (from `.env`) | Source framework and migration reference. Maven project: `pom.xml`, `testng-rerun.xml`, `README.md`, `src\test\java\{constants,context,factory,hooks,pages,runner,scenarios\{features,stepDefinitions},utilities}`, `src\test\resources` (`devconfig/qaconfig/qa_drishticonfig/stagingconfig/prodconfig.properties`, `allure.properties`, `Downloads`, `UploadFiles`). It is the complete framework (config, tests, page objects, resources); `target\` and `.idea\` are build/IDE output. |
| Credentials | external file, path supplied at run time via `CREDENTIALS_FILE` (never inside the repo) | `.json` (flat key/value) or Java `.properties` (same as the Selenium suite's `-DcredsFilePath`); template: `credentials.example.json` (placeholders only). |
| Playwright target (primary) | `tests\e2e\`, `src\pages\`, `locators\`, `src\fixtures\`, `config\`, `data\` | All migrated tests, page objects, locators, fixtures and configuration go here (see Code layout). |
| Docs | `docs\` | Playbook, this map, tracker. |

Rules for team members sharing this checkout:

- Selenium files are the source of truth for existing behaviour. Never edit,
  move, rename, delete or reformat anything under `SELENIUM_PROJECT_PATH`.
- Migrated specs, page objects, locators, fixtures and config are created only in
  the Playwright directories above. Pull from the Selenium source by reading it.
- The Selenium repo is not tracked by the Playwright repo; each member
  keeps their own local copy and points `SELENIUM_PROJECT_PATH` at it. Credentials never live in either repo.
- Update `docs/migration-tracker.md` for every migrated module so others do not
  duplicate work.

## Environment selection

Selector: env var **`TEST_ENV`** (default `local`, the demo app, so always set it
for Keysight work). Registered: `local`, `dev` (placeholder), `staging`, `qa`,
`prod` (placeholder). Unknown values fail with the list of known names.
Default for migration work is STG.

| Request | Command |
| --- | --- |
| default / STG | `$env:TEST_ENV="staging"` |
| QA (only if asked) | `$env:TEST_ENV="qa"` |

```powershell
$env:TEST_ENV="qa"; $env:AI_HEAL="off"
npx playwright test tests/e2e/account-settings.spec.ts --project=chromium-KSP --grep "DCX-9680\b"
```

- `qa` entry (added; URL copied from Selenium `qaconfig.properties`):
  `https://keysightsales--sfcamsqa.sandbox.my.site.com/KeysightdCX/s/?language=en_US`.
  Same roles (`KSP`, `CAMSTHALES`) and same creds keys as STG (as Selenium uses
  one creds file for all envs). **Not yet executed**: discovery only
  (`--list` gives 14 tests for `chromium-KSP` in both envs); whether the QA
  accounts exist/work and whether locators hold in QA is unverified.
- Storage state is per environment: `.auth/<env>-<ROLE>.json`; STG state is
  never reused for QA. `.env.qa` is auto-loaded if present (not present in this
  checkout).
- Page URLs are never hardcoded in specs; they derive from `baseURL`/`startPath`.

## Environment details (staging)

- `TEST_ENV=staging` selects the `staging` entry in `config/environments.ts`.
- Base URL `https://stgsupport.keysight.com/s/` + `startPath` `?language=en_US`
  = `https://stgsupport.keysight.com/s/?language=en_US`. `BASE_URL` is
  deliberately **not** honoured for staging.
- `readOnly: false`, `timeoutFactor: 4`, `authStrategy: 'per-role'`,
  `disableTrace: true` (traces would record typed values).
- Local settings: `.env` at the repo root (gitignored; every supported
  variable is listed in the committed template `.env.example`). Load order:
  shell/CI variables > `.env.<TEST_ENV>` > `.env`; a variable with an empty
  value (`KEY=`) counts as unset. `TEST_ENV` itself may be set in `.env`
  (`config/environments.ts` `currentEnvName()` reads it), so with the checked-in
  template a plain `npx playwright test` runs staging with `AI_HEAL=off`.
  Set `CREDENTIALS_FILE=<path>` there instead of in each shell.

## Credentials

Four separate concerns:

| Concern | Where | Notes |
| --- | --- | --- |
| Storage | A credentials file kept **outside** this repository, owned by each developer | Never committed, copied into the repo, or printed. `credentials.example.json` (placeholders only) shows the structure. |
| Runtime configuration | Env var **`CREDENTIALS_FILE`** | Holds the path of that file. No default path; nothing assumes a directory. Set per shell session, or in a local, gitignored `.env.<TEST_ENV>`. |
| Resolution | `config/creds-file.ts`, via `fileUser()` in `config/environments.ts` | Maps role -> credential keys and reads values lazily, only when a login needs them. |
| Authentication | `tests/auth.setup.ts`, `LoginPage`, extra-user sessions | Read `env.users` / `env.extraUsers`; no credentials in code. |

**Supplying the file (each developer, on their own machine)**

- Every developer must provide a valid path to their own credentials file in
  `CREDENTIALS_FILE` when running tests. Replace `<path-to-credentials-file>`
  in the example below with the real path on your machine.
- Keep the file outside the Playwright repository; never commit it.
- `CREDS_FILE_PATH` remains supported as a legacy alias (used only when
  `CREDENTIALS_FILE` is unset).
- Supported formats, chosen by file extension: `.json` (flat object of
  `"Key": "value"` string pairs, e.g. `"KSP_Username"`) and anything else is
  parsed as Java `.properties` (the same file the Selenium suite takes via
  `-DcredsFilePath`; see `TestRunner`, `RerunTestRunner`, `CredsLoader`).

```powershell
cd D:\Keysight_Playwright_migration\drishti-test-automation
$env:TEST_ENV="staging"; $env:AI_HEAL="off"; $env:CREDENTIALS_FILE="<path-to-credentials-file>"; npx playwright test --grep "DCX-10954\b" --project=chromium-KSP --headed
```

**Resolution and validation (as implemented)**

1. If an env var named exactly like the key exists (e.g. `KSP_Password`), it
   wins for that key.
2. Otherwise the value comes from the file named by `CREDENTIALS_FILE`
   (then `CREDS_FILE_PATH`). The file is read once and cached.
3. Failures raise errors that name keys and the file path only, never values
   or file contents: variable unset; file missing/unreadable; invalid JSON;
   JSON that is not a flat object or has a non-string value; key missing or
   empty. Credentials are resolved when first used, so a missing key fails only
   the role that needs it.

**Security behaviour**

- Verified: no credentials in source; errors do not include values; staging
  and qa set `disableTrace: true`, so Playwright traces (which record typed
  values) are off for them.
- Not guaranteed: `playwright.config.ts` still produces screenshots
  (`only-on-failure`) and videos (`retain-on-failure`). A password field is
  masked on screen, but a screenshot or video can show the username and page
  content. Treat `test-results/` and `playwright-report/` as sensitive; both
  are gitignored.
- Never print values. Inspect credential files by key name only.

**Key coverage**

The key table below was derived from `LoginSteps.java`. Whether a given key
exists is a property of each developer's own file; check by key name only. The
keys `CAMSLEONARDO1_*`, `KSP_SCP_*`, `BMW_SH_*` and `CAMS_Prod_*` were absent
from the file used when this was written.

### Git exposure

The root `.gitignore` ignores `Creds/`, `credentials*.json` (except
`credentials.example.json`), `*.properties`, `.env*` (except `*.example`),
`.auth/`, `Selenium/`, `node_modules/`, `test-results/`, `playwright-report/`
and the `.ai` run artifacts. Stage files by explicit path rather than
`git add .`.

### Selenium role -> credential keys (from `LoginSteps.java`)

| Role | Keys | In creds file? | In Playwright env? |
| --- | --- | --- | --- |
| KSP | `KSP_Username/Password` | yes | **yes** |
| CAMSTHALES | `CAMSTHALES_Username/Password` | yes | **yes** |
| CAMSLEONARDO | `CAMSLEONARDO_*` | yes | no |
| CAMSLEONARDO1 | `CAMSLEONARDO1_*` | **missing** | no |
| ENTITLEUSER | `ENTITLEUSER_*` | yes | no |
| KSP_ChangePassword | `NEW_KSP_*` | yes | no |
| CAMSTHALES_ChangePassword | `NEW_CAMS_*` | yes | no |
| KSP_SCP | `KSP_SCP_*` | **missing** | no |
| KSP_NT | `KSP_NT_*` | yes | no |
| BMW | `BMW_*` | yes | no |
| SH_BMW | `BMW_SH_*` | **missing** | no |
| KSP_User1..6 | `KSP_TM_Username1..6` / `KSP_TM_Password1..6` | yes | no |
| TM_WF_01 / 02 | `KSP_TM_*7` / `KSP_TM_*8` | yes | no |
| NON_Entitle_User | `NON_Entitle_Username`; Selenium reads password via `KSP_Password` (quirk, verify) | yes | no |
| KSP_Prod / CAMS_Prod | prod keys | CAMS_Prod missing | no (prod out of scope) |

Report missing keys by name; never invent them.

## Authentication lifecycle (verified on STG)

- `playwright.config.ts` (per-role): setup project `auth-<ROLE>` and browser
  projects `<browser>-<ROLE>` (e.g. `chromium-KSP`) filtered by tag `@<ROLE>`,
  `storageState = .auth/staging-<ROLE>.json`, `dependencies: ['auth-<ROLE>']`.
  Roles = `Object.keys(env.users)`.
- `tests/auth.setup.ts`: deletes old state, logs in via `LoginPage`, runs
  `expectLoggedIn()`, writes temp file then renames. Failed login leaves no state.
- `.auth/` and `.env*` are gitignored (root `.gitignore`); do not commit them.
- `sessionStorage` was not needed (cookies + localStorage suffice).
- Project names are never plain `chromium`.

## Code layout

| Concern | Location |
| --- | --- |
| Specs | `tests/e2e/<module>.spec.ts` |
| Page objects | `src/pages/<module>.page.ts` extending `BasePage` |
| Shared pages | `login`, `home`, `account-settings`, `my-profile` |
| Locators | `locators/<namespace>.locators.yml` |
| Fixtures | `src/fixtures/index.ts` (`ui`, `env`, `dataset`, `data`, `state`, `seed`) |
| UI actions | `src/fixtures/smart-page.ts` (`useInnerText` option) |
| Env/users | `config/environments.ts`, `config/creds-file.ts` |
| Migration agent | `.github/agents/selenium-playwright-migration.agent.md` |

## Commands (PowerShell; no `&&`)

`package.json` scripts like `test:staging` use POSIX env syntax and fail in PowerShell.

```powershell
$env:TEST_ENV="staging"; $env:AI_HEAL="off"
npx tsc --noEmit
npx playwright test --list --project=chromium-KSP
npx playwright test --project=auth-KSP
npx playwright test <spec> --project=chromium-KSP --workers=1 --grep "DCX-9680\b"
npx playwright test <spec> --project=chromium-KSP --project=chromium-CAMSTHALES --grep "DCX-7764\b|DCX-9520\b"
npx playwright test --grep "@MyProfilePersonalInformation"
```

End ID greps with `\b` to avoid prefix collisions.

### Terminal trigger for "Migrate <ids>/<module>"

`npm run migrate` (`tools/migrate.ts`, parsing in `src/migration/migrate-cli.ts`) starts the Copilot CLI with the same prompt as the chat command; the workflow itself is still the `aiqa-ksp-migration` skill. Needs the `copilot` CLI on PATH. `--env` is case-insensitive (`Stage` = `staging`).

```powershell
npm run migrate -- --test "@DCX-7944" --env Stage
npm run migrate -- --test "@DCX-7944,@DCX-7945" --env Stage
npm run migrate -- --module "ProductLifeCycle" --env Stage
npm run migrate -- --test "@DCX-7944" --dry-run   # print the prompt only
npm run migrate -- --test "@DCX-7944" --print     # non-interactive (copilot -p)
npm run test:unit                                  # argument-parsing tests
```

## Known gaps (not addressed)

1. **Multi-user tests**: solved by `env.extraUsers` (`config/environments.ts`; staging and qa define `KSP_User6` -> `KSP_TM_Username6/Password6`). Extra users get no auth project or storage state: the spec calls `ensureExtraUserState` in `beforeAll` (`src/fixtures/extra-user-session.ts`): it reuses `.auth/<env>-<user>.json` if the session is still valid, else signs in via `LoginPage` and rewrites it atomically. Run with `--no-deps` to avoid the role's auth project. Add other Selenium users (`KSP_User1..5` -> `KSP_TM_*1..5`) the same way when needed.
2. `.github/workflows/e2e.yml` defaults PRs to `TEST_ENV=dev` (violates STG-only); unchanged.
3. Firefox/WebKit/mobile never run on STG.
