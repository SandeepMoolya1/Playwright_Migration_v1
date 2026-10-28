/**
 * Migration orchestration.
 *
 * `analyse` reads a Selenium/Java tree into the inventory model; `migrate`
 * turns that inventory into framework artefacts and a report. Both are
 * deterministic and work offline — the optional AI pass in `ai-upgrade.ts`
 * runs afterwards and only ever *improves* what is already correct.
 *
 * Nothing is written outside the chosen output directory unless `apply` is
 * set, so the default flow is: migrate → read the report → review the drafts
 * → apply.
 */
import fs from 'node:fs';
import path from 'node:path';
import { getConfig } from '../core/config.js';
import { createLogger } from '../core/logger.js';
import { findJavaFiles, parseJavaFile } from './java-parser.js';
import {
  emitFeatureSpec,
  emitLocators,
  emitPageObject,
  emitSpec,
  namespaceOf,
  pageFileName,
  specFileName,
} from './emit.js';
import type { LocatorEmission } from './emit.js';
import { findFeatureFiles, parseFeatureFile, type GherkinFeature } from './gherkin.js';
import { collectStepDefinitions, isStepDefinitionClass, matchStep, type StepDefinition } from './step-defs.js';
import type { MigrationInventory, MigrationOutput, MigrationWarning } from './types.js';

const log = createLogger('migrate');

/* ------------------------------------------------------------- analyse */

export function analyse(root: string): MigrationInventory {
  const files = findJavaFiles(root);
  const classes = [];
  const warnings: MigrationWarning[] = [];
  const stepDefinitions: StepDefinition[] = [];

  for (const file of files) {
    try {
      const parsed = parseJavaFile(file, root);
      if (!parsed) {
        warnings.push({
          file: path.relative(root, file),
          line: 1,
          severity: 'low',
          code: 'no-class',
          message: 'No class declaration found — skipped (interface, enum or record?).',
        });
        continue;
      }
      classes.push(parsed);
      warnings.push(...parsed.warnings);

      // Cucumber glue: the annotations live beside ordinary methods, so the
      // class is parsed once and the step definitions are indexed from it.
      const source = fs.readFileSync(file, 'utf8');
      if (isStepDefinitionClass(source)) {
        stepDefinitions.push(...collectStepDefinitions(parsed, source, warnings));
      }
    } catch (err) {
      warnings.push({
        file: path.relative(root, file),
        line: 1,
        severity: 'high',
        code: 'parse-failed',
        message: `Could not read this file: ${(err as Error).message}`,
      });
    }
  }

  // Feature files may live anywhere — commonly src/test/resources/features.
  const features: GherkinFeature[] = [];
  for (const file of findFeatureFiles(root)) {
    try {
      const feature = parseFeatureFile(file, root);
      features.push(feature);
      for (const u of feature.unparsed) {
        warnings.push({
          file: feature.relativeFile,
          line: u.line,
          severity: 'low',
          code: 'gherkin-unparsed',
          message: 'Line did not match any Gherkin construct and was skipped.',
          source: u.text,
        });
      }
    } catch (err) {
      warnings.push({
        file: path.relative(root, file),
        line: 1,
        severity: 'high',
        code: 'feature-parse-failed',
        message: `Could not read this feature file: ${(err as Error).message}`,
      });
    }
  }

  const steps = classes.flatMap((c) => [
    ...c.tests.flatMap((t) => t.steps),
    ...c.methods.flatMap((m) => m.steps),
    ...Object.values(c.hooks).flat().flatMap((h) => h.steps),
  ]);

  const gherkinSteps = features.flatMap((f) => [
    ...f.background,
    ...f.scenarios.flatMap((sc) => sc.steps),
  ]);
  const unmatchedGherkin = gherkinSteps.filter((gs) => !matchStep(gs, stepDefinitions));

  for (const gs of unmatchedGherkin) {
    warnings.push({
      file: features.find((f) => [...f.background, ...f.scenarios.flatMap((sc) => sc.steps)].includes(gs))?.relativeFile ?? '(feature)',
      line: gs.line,
      severity: 'high',
      code: 'gherkin-unmatched',
      message: 'No step definition matched this Gherkin step — it becomes a failing placeholder.',
      source: `${gs.writtenKeyword} ${gs.text}`,
    });
  }

  return {
    root,
    classes,
    features,
    stepDefinitions,
    warnings,
    stats: {
      files: files.length,
      pages: classes.filter((c) => c.kind === 'page').length,
      testClasses: classes.filter((c) => c.kind === 'test').length,
      tests: classes.reduce((n, c) => n + c.tests.length, 0),
      elements: classes.reduce((n, c) => n + c.fields.length, 0),
      steps: steps.length,
      unsupportedSteps: steps.filter((s) => s.kind === 'unsupported' || s.kind === 'sleep').length,
      featureFiles: features.length,
      scenarios: features.reduce((n, f) => n + f.scenarios.length, 0),
      gherkinSteps: gherkinSteps.length,
      unmatchedGherkinSteps: unmatchedGherkin.length,
      stepDefinitions: stepDefinitions.length,
    },
  };
}

/* ------------------------------------------------------------- migrate */

export interface MigrateOptions {
  /** Directory holding the Selenium sources. */
  root: string;
  /** Where drafts are written. Default `migration/output`. */
  outDir: string;
  /** Also write into `locators/`, `tests/e2e/` and `src/pages/`. */
  apply?: boolean;
  /** `meta.url` for generated locator files. */
  url?: string;
  testIdAttribute?: string;
}

export function migrate(opts: MigrateOptions): MigrationOutput {
  const inventory = analyse(opts.root);
  const testIdAttribute = opts.testIdAttribute ?? getConfig().testIdAttribute;

  const locatorFiles: MigrationOutput['locatorFiles'] = [];
  const specFiles: MigrationOutput['specFiles'] = [];
  const pageObjects: MigrationOutput['pageObjects'] = [];
  const emissions: LocatorEmission[] = [];

  for (const cls of inventory.classes) {
    const locators = emitLocators(cls, testIdAttribute, opts.url);
    if (locators) {
      emissions.push(locators);
      locatorFiles.push({
        namespace: locators.namespace,
        path: path.join('locators', `${locators.namespace}.locators.yml`),
        yaml: locators.yaml,
      });
    }

    if ((cls.kind === 'page' || cls.kind === 'steps') && cls.methods.length && cls.fields.length) {
      pageObjects.push({
        path: path.join('src', 'pages', pageFileName(cls.name)),
        code: emitPageObject(cls),
      });
    }

    if (cls.kind === 'test' && cls.tests.length) {
      specFiles.push({
        path: path.join('tests', 'e2e', specFileName(cls.name)),
        code: emitSpec(cls, inventory),
      });
    }
  }

  // BDD: one spec per feature file, driven by the matched step definitions.
  // The scenarios carry the behaviour, so the glue classes produce locators
  // and page objects but never a spec of their own.
  for (const feature of inventory.features) {
    const emission = emitFeatureSpec(feature, inventory.stepDefinitions);
    specFiles.push({ path: emission.path, code: emission.code });
  }

  const report = renderReport(inventory, emissions, opts);
  const output: MigrationOutput = { locatorFiles, specFiles, pageObjects, report, inventory };

  writeOutput(output, opts);
  return output;
}

function writeOutput(output: MigrationOutput, opts: MigrateOptions): void {
  const write = (base: string, relative: string, contents: string) => {
    const full = path.join(base, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    if (fs.existsSync(full)) {
      fs.copyFileSync(full, `${full}.bak`);
      log.warn(`${path.relative(process.cwd(), full)} existed — previous version saved as .bak`);
    }
    fs.writeFileSync(full, contents, 'utf8');
  };

  for (const f of output.locatorFiles) write(opts.outDir, f.path, f.yaml);
  for (const f of output.specFiles) write(opts.outDir, f.path, f.code);
  for (const f of output.pageObjects) write(opts.outDir, f.path, f.code);

  fs.mkdirSync(opts.outDir, { recursive: true });
  fs.writeFileSync(path.join(opts.outDir, 'MIGRATION-REPORT.md'), output.report, 'utf8');
  fs.writeFileSync(
    path.join(opts.outDir, 'inventory.json'),
    JSON.stringify(output.inventory, null, 2),
    'utf8',
  );

  if (opts.apply) {
    const root = getConfig().rootDir;
    for (const f of output.locatorFiles) write(root, f.path, f.yaml);
    for (const f of output.specFiles) write(root, f.path, f.code);
    for (const f of output.pageObjects) write(root, f.path, f.code);
    log.ok('applied into locators/, tests/e2e/ and src/pages/');
  }
}

/* -------------------------------------------------------------- report */

export function renderReport(
  inventory: MigrationInventory,
  emissions: LocatorEmission[],
  opts: MigrateOptions,
): string {
  const s = inventory.stats;
  const lines: string[] = [
    '# Selenium → Playwright migration report',
    '',
    `Source: \`${inventory.root}\``,
    `Generated: ${new Date().toISOString()}`,
    '',
    '## What was found',
    '',
    '| | Count |',
    '| --- | --- |',
    `| Java files | ${s.files} |`,
    `| Page objects | ${s.pages} |`,
    `| Test classes | ${s.testClasses} |`,
    `| Tests | ${s.tests} |`,
    `| Elements | ${s.elements} |`,
    `| Statements translated | ${s.steps - s.unsupportedSteps} of ${s.steps} |`,
    `| Needing a human | ${s.unsupportedSteps} |`,
    ...(s.featureFiles
      ? [
          `| Feature files | ${s.featureFiles} |`,
          `| Scenarios | ${s.scenarios} |`,
          `| Step definitions | ${s.stepDefinitions} |`,
          `| Gherkin steps bound | ${s.gherkinSteps - s.unmatchedGherkinSteps} of ${s.gherkinSteps} |`,
        ]
      : []),
    '',
  ];

  const coverage = s.steps ? Math.round(((s.steps - s.unsupportedSteps) / s.steps) * 100) : 100;
  lines.push(
    `**${coverage}% of statements translated automatically.** The rest are marked`,
    '`TODO(migration)` in the generated specs, with the original Java inline.',
    '',
  );

  /* ---- BDD ---- */
  if (s.featureFiles) {
    const bound = s.gherkinSteps
      ? Math.round(((s.gherkinSteps - s.unmatchedGherkinSteps) / s.gherkinSteps) * 100)
      : 100;

    lines.push(
      '## BDD / Cucumber',
      '',
      `This suite is BDD. **${bound}% of Gherkin steps were bound** to a step`,
      'definition and translated.',
      '',
      'The Gherkin structure is preserved rather than flattened: each scenario',
      'becomes a `test`, and each Given/When/Then becomes a named `test.step`,',
      'so the HTML report and the trace still read like the feature file. Tags',
      'carry across as Playwright tags, `Background` becomes `beforeEach`, and',
      'each `Scenario Outline` row becomes its own test — exactly as Cucumber',
      'runs them.',
      '',
      '| Feature | Scenarios | Outline rows | File |',
      '| --- | --- | --- | --- |',
      ...inventory.features.map((f) => {
        const outlineRows = f.scenarios
          .filter((sc) => sc.isOutline)
          .reduce((n, sc) => n + sc.examples.reduce((m, e) => m + e.rows.length, 0), 0);
        return `| ${f.name} | ${f.scenarios.length} | ${outlineRows} | \`${f.relativeFile}\` |`;
      }),
      '',
    );

    if (s.unmatchedGherkinSteps) {
      lines.push(
        `> ${s.unmatchedGherkinSteps} Gherkin step(s) had no matching definition. They are emitted`,
        '> as tests that throw, so they fail loudly rather than passing vacuously.',
        '> Usually this means the glue class was outside the scanned directory, or',
        '> the step uses a custom parameter type — see the `gherkin-unmatched`',
        '> entries below.',
        '',
      );
    }

    lines.push(
      '### Keeping the `.feature` files',
      '',
      'The generated specs do not need a BDD runner, which is why this is the',
      'default. If business stakeholders read the `.feature` files, keep them in',
      'the repository as the source of truth for *intent* and treat the specs as',
      'the implementation — or adopt `playwright-bdd`, which runs `.feature`',
      'files directly against Playwright. Both work with this framework, because',
      'the step bodies only ever call the `ui` fixture.',
      '',
    );
  }

  /* ---- locator quality ---- */
  const all = emissions.flatMap((e) => e.quality);
  if (all.length) {
    const byQuality = { good: 0, fair: 0, poor: 0 };
    for (const q of all) byQuality[q.quality]++;

    lines.push(
      '## Locator quality',
      '',
      'Every locator was translated faithfully. "Good" means the translation is',
      'provably equivalent and idiomatic; "fair" works but is not semantic;',
      '"poor" should be rewritten before you rely on it.',
      '',
      '| Quality | Count |',
      '| --- | --- |',
      `| good | ${byQuality.good} |`,
      `| fair | ${byQuality.fair} |`,
      `| poor | ${byQuality.poor} |`,
      '',
    );

    const needsWork = all.filter((q) => q.quality !== 'good');
    if (needsWork.length) {
      lines.push(
        '### Worth rewriting',
        '',
        '| Locator | From | Why |',
        '| --- | --- | --- |',
        ...needsWork
          .sort((a, b) => (a.quality === 'poor' ? -1 : 1) - (b.quality === 'poor' ? -1 : 1))
          .map((q) => `| \`${q.key}\` | \`${q.from}\` | ${q.note ?? q.quality} |`),
        '',
        'Run `npx aiqa scan <url>` against the real page and copy the semantic',
        'locators it produces, or use `npx aiqa migrate --url <url>` to have the',
        'AI pass upgrade them against the live DOM.',
        '',
      );
    }
  }

  /* ---- things needing a human ---- */
  const byCode = new Map<string, MigrationWarning[]>();
  for (const w of inventory.warnings) {
    byCode.set(w.code, [...(byCode.get(w.code) ?? []), w]);
  }

  if (byCode.size) {
    lines.push('## Needs a human', '');
    const order = ['high', 'medium', 'low'] as const;
    const sorted = [...byCode.entries()].sort(
      (a, b) => order.indexOf(a[1][0]!.severity) - order.indexOf(b[1][0]!.severity),
    );

    for (const [code, warnings] of sorted) {
      const first = warnings[0]!;
      lines.push(
        `### \`${code}\` — ${warnings.length} occurrence${warnings.length === 1 ? '' : 's'} (${first.severity})`,
        '',
        first.message,
        '',
        ...warnings.slice(0, 12).map((w) => `- \`${w.file}:${w.line}\`` + (w.source ? ` — \`${w.source.slice(0, 120)}\`` : '')),
        warnings.length > 12 ? `- …and ${warnings.length - 12} more` : '',
        '',
      );
    }
  }

  /* ---- per-class detail ---- */
  lines.push('## Files', '', '| Source | Kind | Elements | Tests | Produced |', '| --- | --- | --- | --- | --- |');
  for (const cls of inventory.classes) {
    const produced: string[] = [];
    if (cls.fields.length) produced.push(`locators/${namespaceOf(cls.name)}.locators.yml`);
    if (cls.kind === 'page' && cls.methods.length) produced.push(`src/pages/${pageFileName(cls.name)}`);
    if (cls.kind === 'test' && cls.tests.length) produced.push(`tests/e2e/${specFileName(cls.name)}`);
    lines.push(
      `| \`${cls.relativeFile}\` | ${cls.kind} | ${cls.fields.length} | ${cls.tests.length} | ${produced.join('<br>') || '—'} |`,
    );
  }
  lines.push('');

  /* ---- next steps ---- */
  lines.push(
    '## Next steps',
    '',
    `1. Review the drafts in \`${path.relative(process.cwd(), opts.outDir)}\`.`,
    '2. Work through every `TODO(migration)` — each carries the original Java.',
    '3. Sharpen the locator `description` fields. They are what auto-healing',
    '   matches on, and the generated ones are serviceable, not good.',
    '4. Rewrite the "poor" locators; `npx aiqa scan <url>` drafts better ones.',
    '5. Copy the reviewed files into `locators/`, `tests/e2e/` and `src/pages/`',
    '   (or re-run with `--apply`).',
    '6. `npx aiqa audit` then run the suite.',
    '',
    '## What was deliberately not translated',
    '',
    '- `Thread.sleep` — replaced by nothing. Assert the condition it waited for.',
    '- Implicit waits — Playwright auto-waits; they have no equivalent.',
    '- `JavascriptExecutor`, `Actions`, `Robot` — re-express as real interactions.',
    '- Frame/window/alert switching — use `frame:` in YAML, or `page.on("dialog")`.',
    '- Data providers — move the cases into `data/` and read them via `dataset`.',
    '',
    'These are not gaps in the converter. They are Selenium idioms that exist',
    'because Selenium lacks auto-waiting and a semantic locator engine; carrying',
    'them across would import the flakiness they were written to work around.',
  );

  return lines.filter((l) => l !== undefined).join('\n');
}
