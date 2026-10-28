/**
 * A focused Java reader for Selenium test suites.
 *
 * This is deliberately **not** a general Java parser. Selenium page objects
 * and test classes are highly patterned, and a targeted reader over those
 * patterns is far more predictable than a full grammar — and, critically, it
 * can say precisely what it did not understand instead of guessing.
 *
 * Structural scanning runs over a *mask* of the source in which string
 * literals and comments are replaced by spaces of equal length. Indices stay
 * aligned with the original, so brace matching cannot be derailed by a `}`
 * inside a string or a comment, while the real text is still available for
 * extraction.
 */
import fs from 'node:fs';
import path from 'node:path';
import type {
  JavaClass,
  JavaClassKind,
  JavaField,
  JavaMethod,
  JavaTest,
  MigratedStep,
  MigrationWarning,
  SeleniumLocator,
  TestFramework,
} from './types.js';
import {
  BY_METHODS,
  DROPPED_HELPERS,
  HELPER_CALLS,
  HOW_ENUM,
  SLEEP_MESSAGE,
  UNSUPPORTED_PATTERNS,
  javaLiteralToTs,
  step,
} from './selenium-map.js';

/* ------------------------------------------------------------- masking */

/**
 * Replace string/char literals and comments with spaces, preserving length
 * and newlines. Used only for structural scanning.
 */
function mask(source: string): string {
  const out = source.split('');
  let i = 0;
  const n = source.length;

  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < n; k++) if (out[k] !== '\n') out[k] = ' ';
  };

  while (i < n) {
    const c = source[i];
    const next = source[i + 1];

    if (c === '/' && next === '/') {
      let j = i;
      while (j < n && source[j] !== '\n') j++;
      blank(i, j);
      i = j;
      continue;
    }
    if (c === '/' && next === '*') {
      let j = i + 2;
      while (j < n && !(source[j] === '*' && source[j + 1] === '/')) j++;
      blank(i, Math.min(j + 2, n));
      i = j + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n) {
        if (source[j] === '\\') {
          j += 2;
          continue;
        }
        if (source[j] === c) break;
        if (source[j] === '\n') break; // unterminated — do not run away
        j++;
      }
      blank(i, Math.min(j + 1, n));
      i = j + 1;
      continue;
    }
    i++;
  }
  return out.join('');
}

const lineAt = (source: string, index: number): number =>
  source.slice(0, index).split('\n').length;

/** Index of the `}` matching the `{` at `open`, or -1. */
function matchBrace(masked: string, open: number): number {
  let depth = 0;
  for (let i = open; i < masked.length; i++) {
    if (masked[i] === '{') depth++;
    else if (masked[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/* --------------------------------------------------------- annotations */

/**
 * The contiguous run of annotation, Javadoc and comment lines immediately
 * above `index`. Walking back line by line is what makes this correct
 * regardless of whether the match started at a newline or at a line start —
 * an off-by-one here silently loses every `@Test`, so it is worth the care.
 */
function annotationsAbove(source: string, index: number): string {
  const lines = source.slice(0, index).split('\n');
  const collected: string[] = [];

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim();
    const isAnnotationish =
      line === '' ||
      line.startsWith('@') ||
      line.startsWith('*') ||
      line.startsWith('/*') ||
      line.startsWith('*/') ||
      line.startsWith('//');

    // A continuation of a multi-line annotation: keep taking while the
    // collected text has more '(' than ')'.
    const joined = collected.join('\n');
    const unbalanced =
      (joined.match(/\(/g)?.length ?? 0) > (joined.match(/\)/g)?.length ?? 0);

    if (isAnnotationish || unbalanced) {
      collected.unshift(lines[i]!);
      continue;
    }
    break;
  }
  return collected.join('\n');
}

/** Value of `key = "..."` inside an annotation's parentheses. */
function annotationString(annotation: string, key: string): string | undefined {
  const re = new RegExp(`${key}\\s*=\\s*"((?:[^"\\\\]|\\\\.)*)"`);
  return re.exec(annotation)?.[1];
}

/** Values of `key = { "a", "b" }` or `key = "a"`. */
function annotationStringArray(annotation: string, key: string): string[] {
  const braced = new RegExp(`${key}\\s*=\\s*\\{([^}]*)\\}`).exec(annotation);
  if (braced) return [...braced[1]!.matchAll(/"([^"]*)"/g)].map((m) => m[1]!);
  const single = annotationString(annotation, key);
  return single ? [single] : [];
}

/* -------------------------------------------------------------- fields */

const FIELD_DECL = /(?:public|protected|private)?\s*(?:static\s+)?(?:final\s+)?(List\s*<\s*WebElement\s*>|WebElement)\s+(\w+)\s*(?:;|=)/;

/** `@FindBy(id = "x")` / `@FindBy(how = How.ID, using = "x")` / `@FindBy("x")`. */
function parseFindBy(annotation: string): SeleniumLocator | undefined {
  // how = How.XXX, using = "..."
  const how = /how\s*=\s*How\.(\w+)/.exec(annotation);
  const using = annotationString(annotation, 'using');
  if (how && using !== undefined) {
    const mapped = HOW_ENUM[how[1]!];
    if (mapped) return { how: mapped, value: using };
  }

  // The shorthand attributes, in Selenium's own order of precedence.
  const shorthand: Array<[string, SeleniumLocator['how']]> = [
    ['id', 'id'],
    ['name', 'name'],
    ['css', 'css'],
    ['xpath', 'xpath'],
    ['className', 'className'],
    ['linkText', 'linkText'],
    ['partialLinkText', 'partialLinkText'],
    ['tagName', 'tagName'],
  ];
  for (const [key, mapped] of shorthand) {
    const value = annotationString(annotation, key);
    if (value !== undefined) return { how: mapped, value };
  }
  return undefined;
}

/** `By.id("x")` anywhere in a snippet. */
function parseBy(snippet: string): SeleniumLocator | undefined {
  const m = /By\s*\.\s*(\w+)\s*\(\s*"((?:[^"\\]|\\.)*)"\s*\)/.exec(snippet);
  if (!m) return undefined;
  const how = BY_METHODS[m[1]!];
  if (!how) return undefined;
  return { how, value: m[2]!.replace(/\\"/g, '"') };
}

function extractFields(source: string, masked: string, warnings: MigrationWarning[], file: string): JavaField[] {
  const fields: JavaField[] = [];

  // 1. @FindBy-annotated fields.
  for (const m of source.matchAll(/@FindBy\s*\(([^)]*)\)/g)) {
    const annotationEnd = m.index! + m[0].length;
    const after = source.slice(annotationEnd, annotationEnd + 400);
    const decl = FIELD_DECL.exec(after);
    if (!decl) continue;

    const locator = parseFindBy(m[1]!);
    if (!locator) {
      warnings.push({
        file,
        line: lineAt(source, m.index!),
        severity: 'high',
        code: 'findby-unparsed',
        message: `Could not read @FindBy(${m[1]!.trim()}) — declare this element by hand.`,
        source: m[0],
      });
      continue;
    }

    fields.push({
      name: decl[2]!,
      locator: { ...locator, line: lineAt(source, m.index!) },
      isList: decl[1]!.startsWith('List'),
      comment: javadocAbove(source, m.index!),
      line: lineAt(source, m.index!),
    });
  }

  // 2. `private final By foo = By.id("x");`
  // The argument is matched as a whole string literal: XPaths are full of
  // `()` (`normalize-space()`, `contains(...)`), so `[^)]*` would cut them short.
  for (const m of source.matchAll(/\bBy\s+(\w+)\s*=\s*(By\s*\.\s*\w+\s*\(\s*"(?:[^"\\]|\\.)*"\s*\))/g)) {
    const locator = parseBy(m[2]!);
    if (!locator) continue;
    fields.push({
      name: m[1]!,
      locator: { ...locator, line: lineAt(source, m.index!) },
      isList: false,
      comment: javadocAbove(source, m.index!),
      line: lineAt(source, m.index!),
    });
  }

  void masked;
  return fields;
}

/** The Javadoc or `//` comment directly above an index, as one line. */
function javadocAbove(source: string, index: number): string | undefined {
  const before = source.slice(0, index).trimEnd();
  const doc = /\/\*\*([\s\S]*?)\*\/\s*$/.exec(before);
  if (doc) {
    const text = doc[1]!
      .split('\n')
      .map((l) => l.replace(/^\s*\*\s?/, '').trim())
      .filter((l) => l && !l.startsWith('@'))
      .join(' ')
      .trim();
    return text || undefined;
  }
  // Only a comment on its own line: the previous declaration's string may
  // itself contain `//` (every XPath does), which is not a comment.
  const lastLine = before.slice(before.lastIndexOf('\n') + 1).trim();
  const line = /^\/\/\s*(.+)$/.exec(lastLine);
  return line?.[1]?.trim();
}

/* ------------------------------------------------------------- methods */

const METHOD_SIGNATURE =
  /(?:^|\n)[ \t]*(?:public|protected|private)\s+(?:static\s+)?(?:final\s+)?(?:synchronized\s+)?([\w.<>\[\],\s?]+?)\s+(\w+)\s*\(([^)]*)\)\s*(?:throws\s+[\w.,\s]+?)?\s*\{/g;

interface RawMethod {
  name: string;
  returnType: string;
  params: Array<{ name: string; type: string }>;
  body: string;
  line: number;
  annotations: string;
}

function extractMethods(source: string, masked: string): RawMethod[] {
  const methods: RawMethod[] = [];
  METHOD_SIGNATURE.lastIndex = 0;

  for (const m of masked.matchAll(METHOD_SIGNATURE)) {
    const openIndex = m.index! + m[0].length - 1;
    const close = matchBrace(masked, openIndex);
    if (close === -1) continue;

    const signatureStart = m.index!;
    methods.push({
      name: m[2]!,
      returnType: m[1]!.trim(),
      params: parseParams(source.slice(m.index! + m[0].indexOf('(') + 1, m.index! + m[0].lastIndexOf(')'))),
      body: source.slice(openIndex + 1, close),
      line: lineAt(source, signatureStart),
      annotations: annotationsAbove(source, signatureStart),
    });
  }
  return methods;
}

function parseParams(raw: string): Array<{ name: string; type: string }> {
  // Split on top-level commas only: `Map<String, String> details` is one parameter.
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const c of raw) {
    if (c === '<') depth++;
    else if (c === '>') depth--;
    if (c === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else current += c;
  }
  parts.push(current);
  return parts
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const parts = p.replace(/@\w+\s*/g, '').split(/\s+/);
      const name = parts.pop() ?? 'arg';
      return { type: parts.join(' ') || 'Object', name };
    });
}

/* ---------------------------------------------------------- statements */

/** Split a method body into statements, respecting nesting and strings. */
function splitStatements(body: string, startLine: number): Array<{ text: string; line: number }> {
  const m = mask(body);
  const out: Array<{ text: string; line: number }> = [];
  let depth = 0;
  let start = 0;

  for (let i = 0; i < m.length; i++) {
    const c = m[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === '{' || c === '}' || (c === ';' && depth === 0)) {
      const text = body.slice(start, i).trim();
      if (text) out.push({ text, line: startLine + body.slice(0, start).split('\n').length - 1 });
      start = i + 1;
    }
  }
  const tail = body.slice(start).trim();
  if (tail) out.push({ text: tail, line: startLine + body.slice(0, start).split('\n').length - 1 });
  return out;
}

export interface StatementContext {
  /** Element field names declared on the class. */
  elements: Set<string>;
  /** Page-object variable names (`LoginPage loginPage = ...`). */
  pageVars: Map<string, string>;
  file: string;
  warnings: MigrationWarning[];
}

const ARGS = /\(([\s\S]*)\)\s*$/;

function argList(call: string): string[] {
  const inner = ARGS.exec(call)?.[1] ?? '';
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  const m = mask(inner);
  for (let i = 0; i < inner.length; i++) {
    const c = m[i];
    if (c === '(' || c === '[') depth++;
    if (c === ')' || c === ']') depth--;
    if (c === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += inner[i];
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** Translate one Java statement. Returns `undefined` for noise to drop. */
export function mapStatement(
  raw: string,
  line: number,
  ctx: StatementContext,
): MigratedStep | undefined {
  let text = raw.replace(/\s+/g, ' ').trim();
  if (!text || /^(return|import|package)\b/.test(text)) return undefined;

  // Things that must never be silently translated.
  for (const { re, code, message } of UNSUPPORTED_PATTERNS) {
    if (re.test(text)) {
      ctx.warnings.push({ file: ctx.file, line, severity: 'high', code, message, source: text });
      return step('unsupported', text, line, { note: message });
    }
  }

  if (/Thread\s*\.\s*sleep/.test(text)) {
    ctx.warnings.push({
      file: ctx.file,
      line,
      severity: 'high',
      code: 'thread-sleep',
      message: SLEEP_MESSAGE,
      source: text,
    });
    return step('sleep', text, line, { note: SLEEP_MESSAGE });
  }

  // Navigation
  let m = /driver\s*\.\s*(?:get|navigate\s*\(\s*\)\s*\.\s*to)\s*\(([\s\S]*)\)/.exec(text);
  if (m) return step('goto', text, line, { args: [javaLiteralToTs(m[1]!)] });

  // Page-object method call: loginPage.loginAs("a", "b")
  m = /^(?:\w+\s+)?(\w+)\s*\.\s*(\w+)\s*\(([\s\S]*)\)$/.exec(text);
  if (m && ctx.pageVars.has(m[1]!) && !ctx.elements.has(m[1]!)) {
    return step('callMethod', text, line, {
      target: m[1]!,
      args: [m[2]!, ...argList(text).map(javaLiteralToTs)],
    });
  }

  // `driver.findElement(someByField)` is the other half of the page-object
  // idiom: the locator lives in a `By` field rather than a `@FindBy`. Rewrite
  // it to the field reference so the normal element handling below applies.
  text = text.replace(
    /\b\w*[Dd]river\s*\.\s*findElements?\s*\(\s*(\w+)\s*\)/g,
    (whole, field: string) => (ctx.elements.has(field) ? field : whole),
  );

  // An inline `driver.findElement(By.id("x"))` has no declared element, so it
  // cannot become a locator key. Say so, and show what it should become.
  const inlineBy = /\b\w*[Dd]river\s*\.\s*findElements?\s*\(\s*By\s*\./.test(text);
  if (inlineBy) {
    const message =
      'Inline driver.findElement(By...) — declare this element in the locator YAML and reference it by key.';
    ctx.warnings.push({ file: ctx.file, line, severity: 'medium', code: 'inline-findelement', message, source: text });
    return step('unsupported', text, line, { note: message });
  }

  // Page-object helpers: `clickOnElement(field)`, `waitFor(2)`, ...
  m = /^(?:this\s*\.\s*)?(\w+)\s*\(([\s\S]*)\)$/.exec(text);
  if (m && DROPPED_HELPERS[m[1]!]) return step('comment', text, line, { note: DROPPED_HELPERS[m[1]!] });
  const helper = m ? HELPER_CALLS[m[1]!] : undefined;
  if (m && helper) {
    const args = argList(text);
    const target = args[0]?.trim();
    if (target && ctx.elements.has(target)) {
      const value = helper.value !== undefined ? args[helper.value] : undefined;
      const extra = args.length > (helper.value ?? 0) + 1 ? 'extra arguments were not translated — verify' : undefined;
      return step(helper.kind, text, line, {
        target,
        args: value !== undefined ? [javaLiteralToTs(value)] : [],
        note: [helper.note, extra].filter(Boolean).join('; ') || undefined,
      });
    }
  }

  // Element actions
  const element = (name: string): boolean => ctx.elements.has(name);

  m = /(\w+)\s*\.\s*click\s*\(\s*\)/.exec(text);
  if (m && element(m[1]!)) return step('click', text, line, { target: m[1]! });

  m = /(\w+)\s*\.\s*clear\s*\(\s*\)/.exec(text);
  if (m && element(m[1]!)) return step('clear', text, line, { target: m[1]! });

  m = /(\w+)\s*\.\s*submit\s*\(\s*\)/.exec(text);
  if (m && element(m[1]!)) {
    return step('press', text, line, {
      target: m[1]!,
      args: ["'Enter'"],
      note: 'form.submit() became a keyboard Enter — verify this is what the app expects',
    });
  }

  m = /(\w+)\s*\.\s*sendKeys\s*\(([\s\S]*)\)/.exec(text);
  if (m && element(m[1]!)) {
    const args = argList(text);
    const onlyKeys = args.length > 0 && args.every((a) => /^Keys\./.test(a.trim()));
    if (onlyKeys) {
      return step('press', text, line, {
        target: m[1]!,
        args: args.map(javaLiteralToTs),
      });
    }
    return step('fill', text, line, { target: m[1]!, args: [javaLiteralToTs(args[0] ?? '""')] });
  }

  // Select dropdowns
  m = /new\s+Select\s*\(\s*(\w+)\s*\)\s*\.\s*(selectByVisibleText|selectByValue|selectByIndex)\s*\(([\s\S]*)\)/.exec(text);
  if (m) {
    const value = argList(text)[0] ?? '""';
    return step('selectOption', text, line, {
      target: m[1]!,
      args: [javaLiteralToTs(value)],
      note: m[2] === 'selectByIndex' ? 'selectByIndex became a value match — verify' : undefined,
    });
  }

  // Explicit waits
  m = /ExpectedConditions\s*\.\s*(\w+)\s*\(([\s\S]*?)\)/.exec(text);
  if (m) {
    const condition = m[1]!;
    const args = argList(`(${m[2]!})`);
    const target = args[0]?.trim().replace(/^driver\s*,\s*/, '');
    const known = ctx.elements.has(target ?? '') ? target : undefined;
    switch (condition) {
      case 'visibilityOf':
      case 'visibilityOfElementLocated':
      case 'presenceOfElementLocated':
        return step('expectVisible', text, line, { target: known });
      case 'invisibilityOf':
      case 'invisibilityOfElementLocated':
      case 'stalenessOf':
        return step('expectHidden', text, line, { target: known });
      case 'elementToBeClickable':
        return step('expectEnabled', text, line, { target: known });
      case 'textToBePresentInElement':
      case 'textToBePresentInElementLocated':
        return step('expectContainsText', text, line, {
          target: known,
          args: [javaLiteralToTs(args[1] ?? '""')],
        });
      case 'titleIs':
      case 'titleContains':
        return step('expectTitle', text, line, { args: [javaLiteralToTs(args[0] ?? '""')] });
      case 'urlToBe':
      case 'urlContains':
        return step('expectUrl', text, line, { args: [javaLiteralToTs(args[0] ?? '""')] });
      default:
        return step('expectVisible', text, line, {
          target: known,
          note: `ExpectedConditions.${condition} has no direct equivalent — verify this assertion`,
        });
    }
  }

  // Assertions
  const assertion = mapAssertion(text, line, ctx);
  if (assertion) return assertion;

  // Element state read into a variable — keep as a readText step.
  m = /(\w+)\s*\.\s*(?:getText|getAttribute)\s*\(/.exec(text);
  if (m && element(m[1]!)) return step('readText', text, line, { target: m[1]! });

  // Local variable declarations and anything else we do not model.
  if (/^(WebDriver|WebElement|List|String|int|boolean|var|final)\b/.test(text)) return undefined;
  if (/^(driver\s*\.\s*(quit|close)|wait\s*=|driver\s*=)/.test(text)) return undefined;

  ctx.warnings.push({
    file: ctx.file,
    line,
    severity: 'medium',
    code: 'unmapped-statement',
    message: 'Statement had no known equivalent and was emitted as a TODO.',
    source: text,
  });
  return step('unsupported', text, line, { note: 'no known equivalent' });
}

function mapAssertion(text: string, line: number, ctx: StatementContext): MigratedStep | undefined {
  const isAssert = /\b(Assert|Assertions|assertThat)\b|\bassert(Equals|True|False|NotNull|Null)\b/.test(text);
  if (!isAssert) return undefined;

  const args = argList(text);
  const first = args[0] ?? '';
  const second = args[1] ?? '';

  const elementOf = (expr: string): string | undefined => {
    const m = /(\w+)\s*\./.exec(expr);
    return m && ctx.elements.has(m[1]!) ? m[1]! : undefined;
  };

  // assertEquals(driver.getTitle(), "x")
  if (/getTitle\s*\(/.test(first)) {
    return step('expectTitle', text, line, { args: [javaLiteralToTs(second)] });
  }
  if (/getCurrentUrl\s*\(/.test(first)) {
    return step('expectUrl', text, line, { args: [javaLiteralToTs(second)] });
  }

  // assertTrue(el.isDisplayed())
  if (/isDisplayed\s*\(/.test(first)) {
    const negated = /assertFalse/.test(text);
    return step(negated ? 'expectHidden' : 'expectVisible', text, line, { target: elementOf(first) });
  }
  if (/isEnabled\s*\(/.test(first)) {
    const negated = /assertFalse/.test(text);
    return step(negated ? 'expectDisabled' : 'expectEnabled', text, line, { target: elementOf(first) });
  }
  if (/isSelected\s*\(/.test(first)) {
    return step('expectChecked', text, line, { target: elementOf(first) });
  }

  // assertEquals(loginPage.getErrorText(), "x") — an assertion on a page
  // object's accessor rather than on an element. This is the dominant shape
  // in Cucumber glue, so it is worth translating rather than punting.
  const accessor = /^(\w+)\s*\.\s*(\w+)\s*\(\s*\)$/.exec(first.trim());
  if (accessor && ctx.pageVars.has(accessor[1]!)) {
    const negated = /assertFalse/.test(text);
    const matcher = /assertTrue|assertFalse/.test(text)
      ? negated
        ? 'toBe(false)'
        : 'toBe(true)'
      : `toBe(${javaLiteralToTs(second)})`;
    return step('expectMethodResult', text, line, {
      target: accessor[1]!,
      args: [accessor[2]!, matcher],
    });
  }
  // assertTrue(loginPage.getErrorText().contains("x"))
  const accessorContains =
    /^(\w+)\s*\.\s*(\w+)\s*\(\s*\)\s*\.\s*contains\s*\(\s*("(?:[^"\\]|\\.)*")\s*\)$/.exec(
      first.trim(),
    );
  if (accessorContains && ctx.pageVars.has(accessorContains[1]!)) {
    return step('expectMethodResult', text, line, {
      target: accessorContains[1]!,
      args: [accessorContains[2]!, `toContain(${javaLiteralToTs(accessorContains[3]!)})`],
    });
  }

  // assertEquals(el.getText(), "x")
  if (/getText\s*\(/.test(first)) {
    return step('expectText', text, line, {
      target: elementOf(first),
      args: [javaLiteralToTs(second)],
    });
  }
  if (/getAttribute\s*\(\s*"value"\s*\)/.test(first)) {
    return step('expectValue', text, line, {
      target: elementOf(first),
      args: [javaLiteralToTs(second)],
    });
  }
  if (/\.size\s*\(\s*\)|\.getSize\s*\(/.test(first)) {
    return step('expectCount', text, line, {
      target: elementOf(first),
      args: [javaLiteralToTs(second)],
    });
  }
  // assertTrue(el.getText().contains("x"))
  const contains = /(\w+)\s*\.\s*getText\s*\(\s*\)\s*\.\s*contains\s*\(\s*("(?:[^"\\]|\\.)*")\s*\)/.exec(text);
  if (contains) {
    return step('expectContainsText', text, line, {
      target: ctx.elements.has(contains[1]!) ? contains[1]! : undefined,
      args: [javaLiteralToTs(contains[2]!)],
    });
  }

  ctx.warnings.push({
    file: ctx.file,
    line,
    severity: 'medium',
    code: 'unmapped-assertion',
    message: 'Assertion shape not recognised — translate it by hand.',
    source: text,
  });
  return step('unsupported', text, line, { note: 'assertion shape not recognised' });
}

/* ---------------------------------------------------------- the class */

function detectFramework(imports: string[]): TestFramework {
  if (imports.some((i) => i.startsWith('org.testng'))) return 'testng';
  if (imports.some((i) => i.startsWith('org.junit.jupiter'))) return 'junit5';
  if (imports.some((i) => i === 'org.junit.Test' || i.startsWith('org.junit.'))) return 'junit4';
  return 'unknown';
}

function detectKind(
  name: string,
  file: string,
  hasTests: boolean,
  isAbstract: boolean,
  hasStepDefs: boolean,
): JavaClassKind {
  if (hasTests) return 'test';
  // Cucumber glue holds behaviour but no tests; the scenarios drive it.
  if (hasStepDefs || /Steps$|StepDefs$|StepDefinitions$/.test(name)) return 'steps';
  if (isAbstract || /^(Base|Abstract)/.test(name) || /(Base|Hooks|Runner)$/.test(name)) return 'base';
  if (/Page$|PageObject$|Screen$|View$/.test(name)) return 'page';

  // Directory hints. `src/test/java` is where *all* Java test code lives
  // under Maven, so a bare `test` segment says nothing — only look for the
  // conventional leaf folders.
  if (/[\\/](pages?|pageobjects?|screens?)[\\/]/i.test(file)) return 'page';
  if (/[\\/](steps?|stepdefs?|stepdefinitions?|glue)[\\/]/i.test(file)) return 'steps';
  if (/[\\/]tests?[\\/][^\\/]*$/i.test(file)) return 'test';
  if (/Test$|Tests$|IT$|ITCase$/.test(name)) return 'test';
  return 'unknown';
}

const TEST_ANNOTATION = /@Test\b/;
const BEFORE_ALL = /@(BeforeClass|BeforeAll|BeforeSuite)\b/;
const BEFORE_EACH = /@(BeforeMethod|BeforeEach|Before)\b/;
const AFTER_EACH = /@(AfterMethod|AfterEach|After)\b/;
const AFTER_ALL = /@(AfterClass|AfterAll|AfterSuite)\b/;

export function parseJavaFile(file: string, root: string): JavaClass | undefined {
  const source = fs.readFileSync(file, 'utf8');
  const masked = mask(source);
  const warnings: MigrationWarning[] = [];
  const relativeFile = path.relative(root, file);

  const classMatch = /(?:^|\n)\s*(?:public\s+)?(abstract\s+)?class\s+(\w+)(?:\s+extends\s+([\w.<>]+))?/.exec(masked);
  if (!classMatch) return undefined;

  const imports = [...source.matchAll(/import\s+(?:static\s+)?([\w.*]+)\s*;/g)].map((m) => m[1]!);
  const fields = extractFields(source, masked, warnings, relativeFile);
  const rawMethods = extractMethods(source, masked);

  const elements = new Set(fields.map((f) => f.name));
  const pageVars = new Map<string, string>();
  for (const m of source.matchAll(/(?:^|\s)([A-Z]\w*(?:Page|PageObject|Screen|View))\s+(\w+)\s*(?:=|;)/g)) {
    pageVars.set(m[2]!, m[1]!);
  }

  const ctx: StatementContext = { elements, pageVars, file: relativeFile, warnings };

  const toMethod = (raw: RawMethod): JavaMethod => ({
    name: raw.name,
    params: raw.params,
    returnType: raw.returnType,
    body: raw.body,
    line: raw.line,
    steps: splitStatements(raw.body, raw.line)
      .map((s) => mapStatement(s.text, s.line, ctx))
      .filter((s): s is MigratedStep => s !== undefined),
  });

  const tests: JavaTest[] = [];
  const methods: JavaMethod[] = [];
  const hooks = { beforeAll: [] as JavaMethod[], beforeEach: [] as JavaMethod[], afterEach: [] as JavaMethod[], afterAll: [] as JavaMethod[] };

  for (const raw of rawMethods) {
    const a = raw.annotations;
    const method = toMethod(raw);

    if (TEST_ANNOTATION.test(a)) {
      tests.push({
        ...method,
        title:
          annotationString(a, 'description') ??
          annotationString(a, 'value') ??
          /\@DisplayName\s*\(\s*"([^"]*)"/.exec(a)?.[1] ??
          humanise(raw.name),
        tags: [...annotationStringArray(a, 'groups'), ...[...a.matchAll(/@Tag\s*\(\s*"([^"]*)"/g)].map((m) => m[1]!)],
        skipped: /enabled\s*=\s*false/.test(a) || /@(Disabled|Ignore)\b/.test(a),
        dataProvider: annotationString(a, 'dataProvider') ?? (/@ParameterizedTest\b/.test(a) ? raw.name : undefined),
      });
      continue;
    }

    if (BEFORE_ALL.test(a)) hooks.beforeAll.push(method);
    else if (BEFORE_EACH.test(a)) hooks.beforeEach.push(method);
    else if (AFTER_EACH.test(a)) hooks.afterEach.push(method);
    else if (AFTER_ALL.test(a)) hooks.afterAll.push(method);
    else methods.push(method);
  }

  const name = classMatch[2]!;
  return {
    file,
    relativeFile,
    package: /package\s+([\w.]+)\s*;/.exec(source)?.[1],
    name,
    kind: detectKind(
      name,
      file,
      tests.length > 0,
      Boolean(classMatch[1]),
      /@(Given|When|Then|And|But)\s*\(/.test(source),
    ),
    extendsClass: classMatch[3],
    imports,
    fields,
    methods,
    tests,
    hooks,
    framework: detectFramework(imports),
    warnings,
  };
}

/** `loginWithValidCredentials` → `login with valid credentials` */
export function humanise(name: string): string {
  return name
    .replace(/^test/i, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase());
}

/** Recursively collect `.java` files. */
export function findJavaFiles(dir: string, acc: string[] = []): string[] {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'target' || entry.name === 'build' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) findJavaFiles(full, acc);
    else if (entry.name.endsWith('.java')) acc.push(full);
  }
  return acc;
}
