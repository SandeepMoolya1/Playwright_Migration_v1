---
name: aiqa-locators
description: Work with the YAML locator repository - add, fix, rename, audit or regenerate element locators. Use when the request mentions a locator, selector, element key, locators/*.locators.yml, ElementNotFoundError, UnknownElementError, "element not found", "cannot resolve", a strict-mode / ambiguous-match error, getByRole/getByTestId choices, or scanning a page to build locators. Contains the complete YAML schema so the files do not need re-reading.
---

# The locator repository

Every element a test touches is declared in `locators/*.locators.yml` and
referenced as `namespace.elementName`. This file is the complete schema.

## File shape

```yaml
meta:
  name: cart                 # namespace -> `cart.promoInput`
  description: Shopping cart page
  url: /cart                 # required for `aiqa check`
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
    multiple: true

  firstRowRemove:
    description: The remove control inside the first cart line item
    steps:
      - { strategy: testId, text: cart-row }
      - { strategy: role, role: button, name: Remove }
    index: first
```

## Three accepted forms

All normalise to the same definition. Use the least you need.

```yaml
submitButton: "#submit"                        # shorthand string
submitButton: { role: button, name: Sign in }  # inferred strategy
submitButton:                                  # explicit chain
  steps:
    - { strategy: role, role: table, name: Cart }
    - { strategy: role, role: row }
  filter: { hasText: "Widget" }
  index: first
```

A bare string infers its engine like `page.locator()`: `xpath=…`, `css=…`,
`text=…`, a leading `//` is XPath, anything else is CSS.

## Strategies

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

Also `exact: true`, and `regex: true` with `flags:` to treat `name`/`text` as
a regular expression.

**Preference order: `testId` → `role`+`name` → `label`/`placeholder` →
`text` → `css`.** XPath is a last resort.

Never depend on: generated class names (`css-1x2y3z`, `ng-tns-c12`), deep
`:nth-of-type` chains, or dynamic text (dates, counts, currency, usernames).
`aiqa audit` fails the build on these.

## Element fields

| Field | Meaning |
| --- | --- |
| `description` | **The intent.** What healing matches on. Always write one. |
| `steps` | Resolution chain; each step narrows the previous. |
| `fallbacks` | Alternatives tried before any inference. Steps or step-chains. |
| `filter` | `hasText` / `hasNotText` / `has` / `hasNot` / `visible`. |
| `index` | `first`, `last`, or a number (`nth`). |
| `multiple` | Collection — matching many is expected, not a defect. |
| `frame` | Resolve inside this iframe (`frameLocator`) first. |
| `heal` | `false` disables healing for this element. |
| `tags` | Free-form, surfaced by `aiqa audit`. |
| `healedAt` / `healedFrom` | Written by the framework. **Never hand-edit.** |

## `description` is load-bearing

It is not documentation. When a selector stops resolving it is the only
surviving statement of what the test meant, and both the deterministic matcher
and the AI tier read it — the matcher extracts vocabulary *and* the implied
kind of control ("button", "text field", "row").

- Good: `Primary call-to-action that submits the login form`
- Useless: `login button`

## Adding an element

1. `npx aiqa list` — check it is not already declared under another name.
2. Add it to the right namespace file, most durable strategy first.
3. Add `fallbacks` if the primary is not a test id.
4. Add `multiple: true` if it is a collection.
5. `npx aiqa audit` — fix anything HIGH.
6. Run the test that uses it.

To draft a whole page from a live URL:

```bash
npx aiqa scan https://app.test/checkout --name checkout   # AI-named
npx aiqa scan https://app.test/checkout --no-ai           # offline, free
```

Then sharpen the descriptions by hand — the generated ones are serviceable,
not good. An existing file is backed up to `.bak` first.

## Diagnosing errors

**`UnknownElementError: Unknown locator "cart.promoInput"`** — the key is not
in the repository. The error lists near-matches. Either the key is misspelled
or the element needs declaring.

**`ElementNotFoundError: Could not resolve "..." after exhausting every
strategy`** — the element did not resolve and healing could not recover it.
The message lists every tier that was tried. Read it: if it says
`not present on this page`, the test is on the wrong page or the app changed
behaviour. See the `aiqa-healing` skill.

**`resolved to N elements — ambiguous`** — the locator matches several
elements. Either add `index: first`/`last`/`n`, add a `filter`, add a
narrowing step, or — if it is genuinely a collection — set `multiple: true`.

## Commands

```bash
npx aiqa list                  # every key, grouped by namespace
npx aiqa list --json           # machine-readable
npx aiqa audit                 # static quality review; exit 1 on HIGH
npx aiqa check --env staging   # probe every locator against a live env
npx aiqa check --env staging --fix   # write drifted locators back
npx aiqa scan <url> --name <ns>      # build a file from a live page
```

`aiqa check` needs `meta.url`. For elements that only exist in a particular
state (a seeded cart, a logged-in user), set `meta.state` and implement that
name in `aiqa.setup.ts`.

## Conventions

- One namespace per page or major component.
- camelCase keys named for the element's role in the journey
  (`submitButton`, `errorBanner`, `cartRows`) — never `div12`.
- For repeated rows: one entry for the container, one for the row pattern with
  `multiple: true`. Not one entry per row.
