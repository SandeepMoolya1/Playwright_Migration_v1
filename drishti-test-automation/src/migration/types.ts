/**
 * The migration model.
 *
 * A Selenium/Java suite is parsed into these structures *deterministically*
 * first. Everything downstream — the YAML locators, the spec drafts, the
 * report — is generated from this model, so the migration is auditable and
 * reproducible rather than a single opaque translation step.
 */

/** How a Selenium locator finds its element. */
export type SeleniumHow =
  | 'id'
  | 'name'
  | 'css'
  | 'xpath'
  | 'className'
  | 'linkText'
  | 'partialLinkText'
  | 'tagName';

export interface SeleniumLocator {
  how: SeleniumHow;
  value: string;
  /** Source line, for the report and for `// TODO` breadcrumbs. */
  line?: number;
}

/** A `@FindBy` field or an inline `By.…` on a page object. */
export interface JavaField {
  name: string;
  locator: SeleniumLocator;
  /** `List<WebElement>` becomes `multiple: true`. */
  isList: boolean;
  /** Javadoc or trailing comment — reused as the locator `description`. */
  comment?: string;
  line: number;
}

/**
 * One translated action inside a method body.
 *
 * `kind` maps onto the framework's `ui` surface; `unsupported` marks something
 * that needs a human and is emitted as a commented `TODO` rather than guessed.
 */
export type StepKind =
  | 'goto'
  | 'click'
  | 'doubleClick'
  | 'fill'
  | 'type'
  | 'clear'
  | 'press'
  | 'check'
  | 'uncheck'
  | 'selectOption'
  | 'hover'
  | 'upload'
  | 'expectVisible'
  | 'expectHidden'
  | 'expectText'
  | 'expectContainsText'
  | 'expectValue'
  | 'expectEnabled'
  | 'expectDisabled'
  | 'expectChecked'
  | 'expectCount'
  | 'expectUrl'
  | 'expectTitle'
  | 'readText'
  | 'expectMethodResult'
  | 'callMethod'
  | 'comment'
  | 'sleep'
  | 'unsupported';

export interface MigratedStep {
  kind: StepKind;
  /** Page-object field name, resolved to a locator key at emit time. */
  target?: string;
  /** Literal or expression arguments, already TypeScript-safe. */
  args: string[];
  /** The original Java, kept for `TODO` comments and the report. */
  source: string;
  line: number;
  /** Why this needs human attention. Present on `unsupported` and `sleep`. */
  note?: string;
}

export interface JavaMethod {
  name: string;
  params: Array<{ name: string; type: string }>;
  returnType: string;
  steps: MigratedStep[];
  /** Raw body, retained so the AI pass can see what the mapper could not. */
  body: string;
  line: number;
}

export type TestFramework = 'testng' | 'junit4' | 'junit5' | 'unknown';

export interface JavaTest extends JavaMethod {
  /** `@Test(description = "...")`, `@DisplayName("...")`, else the name. */
  title: string;
  /** TestNG groups / JUnit tags — become Playwright tags. */
  tags: string[];
  /** `@Test(enabled = false)`, `@Disabled`, `@Ignore`. */
  skipped: boolean;
  /** `@Test(dataProvider = "...")` / `@ParameterizedTest`. */
  dataProvider?: string;
}

export type JavaClassKind = 'page' | 'test' | 'steps' | 'base' | 'unknown';

export interface JavaClass {
  /** Absolute path of the source file. */
  file: string;
  /** Path relative to the migration root, for reporting. */
  relativeFile: string;
  package?: string;
  name: string;
  kind: JavaClassKind;
  extendsClass?: string;
  imports: string[];
  fields: JavaField[];
  methods: JavaMethod[];
  tests: JavaTest[];
  hooks: {
    beforeAll: JavaMethod[];
    beforeEach: JavaMethod[];
    afterEach: JavaMethod[];
    afterAll: JavaMethod[];
  };
  framework: TestFramework;
  /** Anything the parser saw but could not model. */
  warnings: MigrationWarning[];
}

export interface MigrationWarning {
  file: string;
  line: number;
  severity: 'high' | 'medium' | 'low';
  /** Short machine-readable kind: `thread-sleep`, `js-executor`, … */
  code: string;
  message: string;
  source?: string;
}

/** Everything the parser found, across the whole input tree. */
export interface MigrationInventory {
  root: string;
  classes: JavaClass[];
  /** Parsed `.feature` files. Empty for a non-BDD suite. */
  features: import('./gherkin.js').GherkinFeature[];
  /** Every Cucumber step definition found across the glue classes. */
  stepDefinitions: import('./step-defs.js').StepDefinition[];
  warnings: MigrationWarning[];
  stats: {
    files: number;
    pages: number;
    testClasses: number;
    tests: number;
    elements: number;
    steps: number;
    unsupportedSteps: number;
    featureFiles: number;
    scenarios: number;
    gherkinSteps: number;
    unmatchedGherkinSteps: number;
    stepDefinitions: number;
  };
}

/** What the emitters produced, before anything is written to disk. */
export interface MigrationOutput {
  locatorFiles: Array<{ namespace: string; path: string; yaml: string }>;
  specFiles: Array<{ path: string; code: string }>;
  pageObjects: Array<{ path: string; code: string }>;
  report: string;
  inventory: MigrationInventory;
}
