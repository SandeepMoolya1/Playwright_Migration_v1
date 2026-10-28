/**
 * Cucumber step definitions: find them, and match Gherkin steps against them.
 *
 * Cucumber-JVM accepts two pattern dialects on the same annotations, and a
 * migration has to handle both:
 *
 *   @Given("I log in as {string}")            Cucumber Expression
 *   @Given("^I log in as \"([^\"]*)\"$")      Regular Expression
 *
 * The distinction is not declared anywhere — it is inferred from the shape of
 * the string, exactly as Cucumber itself does.
 */
import type { JavaClass, JavaMethod, MigrationWarning } from './types.js';
import type { GherkinStep } from './gherkin.js';

export interface StepDefinition {
  /** Given / When / Then / And / But, as annotated. */
  keyword: string;
  /** The raw annotation value. */
  pattern: string;
  dialect: 'expression' | 'regex';
  regex: RegExp;
  method: JavaMethod;
  /** Expression dialect: whether each parameter, in order, is a `{string}`. */
  stringParams?: boolean[];
  className: string;
  file: string;
  line: number;
}

/** Cucumber's built-in parameter types, in the order they must be replaced. */
const PARAMETER_TYPES: Array<[RegExp, string]> = [
  // Cucumber accepts either quote; two alternative groups, collapsed in matchStep.
  [/\{string\}/g, `(?:"([^"]*)"|'([^']*)')`],
  [/\{int\}/g, '(-?\\d+)'],
  [/\{biginteger\}/g, '(-?\\d+)'],
  [/\{byte\}/g, '(-?\\d+)'],
  [/\{short\}/g, '(-?\\d+)'],
  [/\{long\}/g, '(-?\\d+)'],
  [/\{float\}/g, '(-?\\d*\\.?\\d+)'],
  [/\{double\}/g, '(-?\\d*\\.?\\d+)'],
  [/\{bigdecimal\}/g, '(-?\\d*\\.?\\d+)'],
  [/\{word\}/g, '([^\\s]+)'],
  [/\{\}/g, '(.*)'],
  // Any custom parameter type: treat as a non-greedy catch-all.
  [/\{[A-Za-z][\w-]*\}/g, '(.+?)'],
];

/**
 * Cucumber treats a pattern as a regular expression when it is anchored or
 * already contains regex syntax; otherwise it is a Cucumber Expression.
 */
function detectDialect(pattern: string): 'expression' | 'regex' {
  if (pattern.startsWith('^') || pattern.endsWith('$')) return 'regex';
  if (/\\[dwsSbWD]|\[\^?.*\]|\(\?:|\(\[|\.\*|\.\+/.test(pattern)) return 'regex';
  return 'expression';
}

/** Cucumber Expression → RegExp. */
export function expressionToRegex(pattern: string): RegExp {
  // Escape regex metacharacters, but keep the Cucumber syntax we handle next:
  // `{...}` parameters, `(...)` optional text and `a/b` alternation.
  let out = pattern.replace(/[.*+?^$[\]\\|]/g, '\\$&');

  // Optional text: `cucumber(s)` → `cucumber(?:s)?`
  out = out.replace(/\(([^)]+)\)/g, '(?:$1)?');

  // Parameters. Braces survived escaping, so they can be replaced directly.
  for (const [re, replacement] of PARAMETER_TYPES) out = out.replace(re, replacement);

  // Alternation: `I click/press the button` → `I (?:click|press) the button`
  out = out.replace(/(\S+)\/(\S+)/g, (_match, a: string, b: string) => `(?:${a}|${b})`);

  return new RegExp(`^${out}$`);
}

export function patternToRegex(pattern: string): { regex: RegExp; dialect: 'expression' | 'regex' } {
  const dialect = detectDialect(pattern);
  if (dialect === 'regex') {
    const body = pattern.replace(/^\^/, '').replace(/\$$/, '');
    return { regex: new RegExp(`^${body}$`), dialect };
  }
  return { regex: expressionToRegex(pattern), dialect };
}

const STEP_ANNOTATION =
  /@(Given|When|Then|And|But)\s*\(\s*"((?:[^"\\]|\\.)*)"\s*\)\s*(?:\n|\r\n|\s)*(?:public|protected|private)?\s*(?:static\s+)?[\w.<>\[\],\s?]+\s+(\w+)\s*\(/g;

/**
 * Collect every step definition on a class.
 *
 * The annotation and the method it decorates are matched by position: the
 * method name captured from the annotation regex is looked up in the class's
 * already-parsed methods, so bodies come from the same reader the rest of the
 * migration uses.
 */
export function collectStepDefinitions(
  cls: JavaClass,
  source: string,
  warnings: MigrationWarning[],
): StepDefinition[] {
  const byName = new Map(cls.methods.map((m) => [m.name, m]));
  const definitions: StepDefinition[] = [];

  STEP_ANNOTATION.lastIndex = 0;
  for (const m of source.matchAll(STEP_ANNOTATION)) {
    const [, keyword, rawPattern, methodName] = m;
    const method = byName.get(methodName!);
    const line = source.slice(0, m.index!).split('\n').length;

    if (!method) {
      warnings.push({
        file: cls.relativeFile,
        line,
        severity: 'medium',
        code: 'stepdef-no-method',
        message: `@${keyword}("${rawPattern}") is bound to ${methodName}(), which could not be read.`,
      });
      continue;
    }

    const pattern = rawPattern!.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    try {
      const { regex, dialect } = patternToRegex(pattern);
      definitions.push({
        keyword: keyword!,
        pattern,
        dialect,
        regex,
        method,
        stringParams:
          dialect === 'expression' ? [...pattern.matchAll(/\{([\w-]*)\}/g)].map((p) => p[1] === 'string') : undefined,
        className: cls.name,
        file: cls.relativeFile,
        line,
      });
    } catch (err) {
      warnings.push({
        file: cls.relativeFile,
        line,
        severity: 'high',
        code: 'stepdef-bad-pattern',
        message: `Could not compile the pattern "${pattern}": ${(err as Error).message}`,
      });
    }
  }

  return definitions;
}

export interface StepMatch {
  definition: StepDefinition;
  /** Captured values, already quoted as TypeScript literals. */
  args: string[];
  /** Step-definition parameter name → the captured literal. */
  bindings: Map<string, string>;
}

/** Match one Gherkin step against the known definitions. */
export function matchStep(
  step: GherkinStep,
  definitions: StepDefinition[],
): StepMatch | undefined {
  for (const definition of definitions) {
    const m = definition.regex.exec(step.text);
    if (!m) continue;

    const captured = collapseCaptures(m, definition.stringParams);
    const args = captured.map(toTsLiteral);

    // Bind captures to the Java method's parameter names, positionally —
    // which is exactly how Cucumber itself binds them.
    const bindings = new Map<string, string>();
    definition.method.params.forEach((param, i) => {
      if (i < args.length) bindings.set(param.name, args[i]!);
    });

    return { definition, args, bindings };
  }
  return undefined;
}

/** One value per parameter: a `{string}` captured into one of two groups. */
function collapseCaptures(m: RegExpExecArray, stringParams: boolean[] | undefined): string[] {
  const groups = m.slice(1);
  if (!stringParams) return groups.map((v) => v ?? '');
  const values: string[] = [];
  let g = 0;
  for (const isString of stringParams) {
    values.push(isString ? (groups[g] ?? groups[g + 1] ?? '') : (groups[g] ?? ''));
    g += isString ? 2 : 1;
  }
  return values;
}

/** A captured Gherkin value → a TypeScript literal. */
function toTsLiteral(value: string): string {
  // A leading zero means an identifier (`02120008`), not a number.
  if (/^-?(0|[1-9]\d*)(\.\d+)?$/.test(value)) return value;
  if (/^(true|false)$/.test(value)) return value;
  // An Examples placeholder that survived substitution becomes a row lookup.
  const placeholder = /^<([^>]+)>$/.exec(value);
  if (placeholder) return `row.${placeholder[1]!.replace(/[^\w]/g, '_')}`;
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** Does this class look like a Cucumber glue class? */
export function isStepDefinitionClass(source: string): boolean {
  return /@(Given|When|Then|And|But)\s*\(/.test(source);
}

/** Cucumber hooks map onto Playwright's beforeEach/afterEach. */
export function collectHooks(source: string): { before: string[]; after: string[] } {
  const before = [...source.matchAll(/@Before\s*(?:\([^)]*\))?\s*(?:public|protected|private)?\s*\w[\w.<>\[\]]*\s+(\w+)\s*\(/g)].map((m) => m[1]!);
  const after = [...source.matchAll(/@After\s*(?:\([^)]*\))?\s*(?:public|protected|private)?\s*\w[\w.<>\[\]]*\s+(\w+)\s*\(/g)].map((m) => m[1]!);
  return { before, after };
}
