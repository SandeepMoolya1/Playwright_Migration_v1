---
name: aiqa-healing
description: Understand, tune, audit or troubleshoot the locator auto-healing system. Use when the request mentions healing, self-healing, auto-heal, locator drift, a healed locator, healedAt/healedFrom, persistHeals, the heal journal or cache, AI_HEAL / AI_HEAL_PERSIST / AI_HEAL_STRICT, confidence thresholds, "why did it heal", "why did it NOT heal", or reviewing heals before committing them. Contains the full cascade and every threshold.
---

# Auto-healing

When a locator stops resolving, the framework tries to recover it rather than
failing the run — then reports exactly what it did.

## The cascade

Cheapest and most certain first. **Every tier's proposal is validated against
the live page before use.** The model never fixes anything by assertion alone.

| Tier | What | Cost |
| --- | --- | --- |
| 0 | The locator as written, waited with the test's real timeout. A slow element is never mistaken for a broken one. | free |
| 1 | `fallbacks` declared in the YAML, in order. | free |
| 2 | Deterministic matcher: scores live page candidates against the declared intent. | free, offline |
| 3 | AI matcher: Claude picks from the aria tree + candidate list, returns ranked proposals with confidence. | one API call |

Between tiers 1 and 2 the page is captured (aria snapshot + candidate list +
structural signature) and the heal cache is consulted.

## The two safeguards

**Unambiguous winner.** Tier 2 only accepts a candidate that stands clearly
apart from the runner-up (score ≥ floor, and ≥ 1.25× the runner-up, or ≥ 0.90).
Two plausible matches means we do not know which control the test meant — the
case where clicking the wrong one does damage, and where tier 3 earns its cost.
Candidates resolving to the *same* locator (every row of a list) are collapsed
first, so a collection is never mistaken for ambiguity.

**Uniqueness.** A healed locator must resolve to exactly one element, unless
the element declares `multiple: true`. A replacement matching five things is
not a repair.

## What the matcher scores

Against the element key, its original matchers, and — critically — its
`description`:

| Signal | Weight |
| --- | --- |
| Identifiers (test id, id, label, placeholder) | 0.34 |
| Accessible name | 0.30 |
| Agreement between identifier and name | 0.10 |
| High-signal core tokens | 0.05 |
| Visible text | 0.07 |
| Role implied by the description | 0.14 |

Special case: the intent names a kind of control and the page has exactly one
visible element of that kind → 0.82. This is what recovers an element whose
every identifier changed.

**This is why `description` is load-bearing.** A vague description permanently
weakens healing for that element.

## Thresholds

| Setting | Default | Meaning |
| --- | --- | --- |
| `heal.enabled` | `true` | Master switch (`AI_HEAL`). |
| `heal.heuristicMinScore` | `0.45` | Floor for tier 2 (`AI_HEAL_MIN_SCORE`). |
| `heal.minConfidence` | `0.7` | Floor for tier 3 (`AI_HEAL_MIN_CONFIDENCE`). |
| `heal.persistMinConfidence` | `0.85` | Floor for writing back to YAML. |
| `heal.persist` | on locally, off in CI | Write heals back (`AI_HEAL_PERSIST`). |
| `heal.strict` | `false` | Fail any test that needed healing (`AI_HEAL_STRICT`). |
| `heal.maxPerRun` | `25` | Hard cap on AI heal calls (`AI_HEAL_MAX_PER_RUN`). |
| `heal.cache` | `true` | Reuse a heal per element + page signature. |

Set in `aiqa.config.ts`; environment variables override.

## Healing never hides drift

- Annotated on the test in the HTML report.
- Journalled to `.ai/heal-journal.jsonl`, rotated each run
  (`.ai/heal-journal.prev.jsonl`).
- Summarised in the terminal, with a precise reason when a heal was **not**
  written back (`opted-out`, `low-confidence`, `persist-disabled`, `fallback`).
- Written back locally above `persistMinConfidence`: the old selector is
  demoted to `fallbacks` and stamped with `healedFrom`, so it is reversible by
  hand and shows up in review as a diff.

```yaml
newTodoInput:
  description: Text field at the top where a new todo is typed
  role: textbox                             # healed
  name: What needs to be done?
  fallbacks:
    - css: "#new-todo-input-v2-renamed"     # demoted, not deleted
  healedAt: 2026-09-28T05:56:34.096Z
  healedFrom: locator('#new-todo-input-v2-renamed')
```

**Review healed YAML before committing.** A heal is a proposal that worked
once, not a verified decision. Confirm it targets the element the test meant —
then delete the `healedAt`/`healedFrom` stamps if you are satisfied.

## Behaviour worth knowing

- An accepted heal is applied to the **in-memory repository for the rest of
  the worker**. An element heals once per worker, not once per test. Tests
  asserting on healing must each use their own element.
- A tier-1 fallback match is an *intended alternative*, not drift — it is
  recorded but never rewrites the YAML.
- `meta.persistHeals: false` heals at runtime but never writes back. Use it
  for pages you do not own and for deliberately-stale fixtures.
- `heal: false` on an element disables healing for it entirely.

## Common questions

**"Why did it not heal?"** Read the `Attempted:` list in the error. Likely:
no clear winner (ambiguous — the message prints both scores); the element is
genuinely absent; `heal: false`; healing disabled; or the AI budget was spent.

**"Why did it heal to the wrong element?"** The description was too vague or
described something else. Fix the description first, then the locator. Check
`.ai/heal-journal.jsonl` for the recorded `reasoning`.

**"How much healing is propping up the suite?"**

```bash
npm run test:nohealing          # what actually breaks
AI_HEAL_STRICT=on npm test      # fail anything that only passed by healing
```

Run the strict variant as a scheduled CI job so healing never becomes a crutch.

## Fixing drift properly

Do not wait for tests to fail. Probe the repository against the environment:

```bash
npx aiqa check --env staging          # report
npx aiqa check --env staging --fix    # apply the clear ones
git diff locators/                    # review every change
```

`DRIFTED` = recovered with a clear winner. `BROKEN` distinguishes
`not present on this page` from `no unambiguous match` — different problems,
different fixes.

## Working offline

Tiers 0–2 need no credentials and no network. Only tier 3 does. With no
credentials the framework degrades cleanly rather than erroring:
`aiqa check`, `aiqa audit`, `aiqa list` and `aiqa scan --no-ai` all still work.
`tests/e2e/healing.spec.ts` proves the cascade offline.
