---
name: aiqa-debug-failure
description: Diagnose a failing, flaky or timing-out Playwright test in this framework. Use when a test fails, is flaky, times out, passes locally but fails in CI, or the request is to investigate/triage/explain a failure, read a trace, or decide whether a failure is an application defect or a test defect. Contains the artifact map and the triage decision tree so the failure can be diagnosed without re-exploring the project.
---

# Diagnosing a failure

Every failure in this framework arrives fully equipped. Read the artifacts
before touching the test — most failures are explained without reproducing.

## Where the evidence is

| Artifact | Path |
| --- | --- |
| Trace (DOM, network, console, time travel) | `test-results/**/trace.zip` |
| Video + failure screenshot | `test-results/**/` |
| Console errors & failed requests (readable) | `ai-diagnostics.md` attachment |
| Accessibility snapshot at the moment of failure | `ai-diagnostics.json` attachment |
| Locators healed during the test | report annotation + the same attachments |
| AI root-cause analysis | `.ai/report/analysis.md` |
| Heal journal for the run | `.ai/heal-journal.jsonl` |
| Previous run's journal | `.ai/heal-journal.prev.jsonl` |

`ai-diagnostics.json` is the richest single file: test title, URL at failure,
error, stack, code frame, console, network, heals, and the aria snapshot.

## Commands

```bash
npx playwright test tests/e2e/<file>.spec.ts --project=chromium --reporter=list
npm run test:ui                         # watch, time travel, pick locators
npm run test:debug                      # Playwright Inspector
npx playwright show-trace test-results/…/trace.zip
npx aiqa explain                        # AI analysis of saved artifacts
npx aiqa explain --input ./ci-artifacts # …from a downloaded CI bundle
npm run test:nohealing                  # what actually breaks with healing off
```

`aiqa explain` needs Anthropic credentials. Everything else works offline.

## Triage order

Work down this list. Stop at the first that fits.

**1. Did a locator heal?** Check the run summary, the test annotations, or
`.ai/heal-journal.jsonl`. A heal means the UI moved. The test is a symptom;
the locator is the cause. Go to the `aiqa-healing` skill.

**2. Is it `ElementNotFoundError`?** Read the `Attempted:` list in the message
— it shows every tier and why each failed.
- `not present on this page` → wrong page, wrong state, or the feature is
  gone. Check `page.url()` in the diagnostics.
- `resolved to N elements` → ambiguous; see the `aiqa-locators` skill.
- everything timed out → the element genuinely never appeared.

**3. Are there console errors or failed requests?** `ai-diagnostics.md` lists
them. A 500 or an uncaught `TypeError` usually means the application broke,
not the test.

**4. Is it timing?** Symptoms: passes alone, fails in parallel; passes locally,
fails in CI; fails at the same step intermittently. Almost always a missing
web-first assertion or an action racing a re-render.

**5. Is it data?** Did the test assume data that another test created, or that
only exists in one environment? Check whether it reads `dataset` or hardcodes
values, and whether fixture data is namespaced per test.

## Classify the failure

This distinction matters more than any other — getting it wrong wastes a
developer's day.

| Category | Meaning | Action |
| --- | --- | --- |
| `app-bug` | The application is wrong | File a defect. Do **not** change the test. |
| `test-bug` | The expectation, wait or flow is wrong | Fix the test. |
| `locator-drift` | Element still exists but moved or was renamed | Fix the YAML. |
| `timing` | App was correct; the test did not wait properly | Replace the wait. |
| `environment` | Config, URL, credentials, deploy state | Fix the environment. |
| `data` | Missing, stale or colliding fixture data | Fix the seeding. |
| `network` | Upstream/3rd-party failure | Usually retry or stub deliberately. |

When the evidence genuinely does not decide it, say so and state which you
can defend — do not invent a tidy story.

## Fixing timing correctly

```ts
// WRONG — never do this in this framework
await page.waitForTimeout(2000);
await ui.click('cart.checkout', { force: true });

// RIGHT — web-first assertions retry until the condition holds
await ui.expect('cart.checkout').toBeEnabled();
await ui.click('cart.checkout');
```

`waitForTimeout`, arbitrary sleeps and `{ force: true }` are banned. They
convert a real race into a slower, still-flaky test.

If an action races a re-render, assert the post-condition of the *previous*
step before acting:

```ts
await ui.click('cart.applyPromo');
await ui.expect('cart.discountRow').toBeVisible();   // the app has settled
await ui.click('cart.checkout');
```

## Flaky vs. broken

A test that passed on retry is flaky, not broken — Playwright marks it and the
reporter says so. Do not "fix" it by loosening an assertion. Find the race:
run it repeatedly and in isolation.

```bash
npx playwright test <file> --repeat-each=10 --project=chromium
npx playwright test <file> --workers=1        # does isolation fix it? -> shared state
```

If `--workers=1` fixes it, the cause is shared state — usually fixture data in
a shared backing store that is not namespaced per test.

## Reporting back

State plainly: what failed, which category, the evidence you used (quote it),
and the fix. If tests still fail after your change, say so with the output.
Never report a fix you have not run.
