/**
 * Gherkin reader.
 *
 * Handles the dialect a real Cucumber-JVM suite actually uses: tags, Feature
 * description, Background, Scenario, Scenario Outline with Examples, doc
 * strings and data tables. Enough to migrate a suite faithfully; anything it
 * cannot read is reported rather than dropped.
 */
import fs from 'node:fs';
import path from 'node:path';

export interface GherkinStep {
  /** Normalised to the effective keyword: And/But inherit the previous one. */
  keyword: 'Given' | 'When' | 'Then';
  /** The keyword as written, for the generated `test.step` title. */
  writtenKeyword: string;
  text: string;
  line: number;
  docString?: string;
  dataTable?: string[][];
}

export interface GherkinExamples {
  name?: string;
  /** Tags on the Examples block; Cucumber adds them to each row's scenario. */
  tags: string[];
  headers: string[];
  rows: string[][];
  line: number;
}

export interface GherkinScenario {
  name: string;
  description?: string;
  tags: string[];
  steps: GherkinStep[];
  isOutline: boolean;
  examples: GherkinExamples[];
  line: number;
}

export interface GherkinFeature {
  file: string;
  relativeFile: string;
  name: string;
  description: string;
  tags: string[];
  background: GherkinStep[];
  scenarios: GherkinScenario[];
  /** Lines the reader could not classify. */
  unparsed: Array<{ line: number; text: string }>;
}

const KEYWORDS = ['Given', 'When', 'Then', 'And', 'But', '*'] as const;

const splitRow = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim().replace(/\\n/g, '\n').replace(/\\\|/g, '|'));

export function parseFeatureFile(file: string, root: string): GherkinFeature {
  const source = fs.readFileSync(file, 'utf8');
  const lines = source.split('\n');

  const feature: GherkinFeature = {
    file,
    relativeFile: path.relative(root, file),
    name: path.basename(file, path.extname(file)),
    description: '',
    tags: [],
    background: [],
    scenarios: [],
    unparsed: [],
  };

  let pendingTags: string[] = [];
  /** Where subsequent steps go. */
  let target: 'none' | 'background' | 'scenario' = 'none';
  let current: GherkinScenario | undefined;
  let currentExamples: GherkinExamples | undefined;
  let lastKeyword: GherkinStep['keyword'] = 'Given';
  let inFeatureDescription = false;

  const pushStep = (step: GherkinStep): void => {
    if (target === 'background') feature.background.push(step);
    else if (target === 'scenario' && current) current.steps.push(step);
  };

  const lastStep = (): GherkinStep | undefined => {
    if (target === 'background') return feature.background.at(-1);
    if (target === 'scenario' && current) return current.steps.at(-1);
    return undefined;
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const line = raw.trim();
    const lineNo = i + 1;

    if (line === '' || line.startsWith('#')) continue;

    // Tags apply to whatever is declared next.
    if (line.startsWith('@')) {
      pendingTags.push(...line.split(/\s+/).filter((t) => t.startsWith('@')).map((t) => t.slice(1)));
      continue;
    }

    // Doc string attached to the previous step.
    if (line.startsWith('"""') || line.startsWith('```')) {
      const fence = line.slice(0, 3);
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith(fence)) {
        body.push(lines[i]!);
        i++;
      }
      const step = lastStep();
      if (step) step.docString = body.join('\n');
      continue;
    }

    // Data table row, or an Examples table.
    if (line.startsWith('|')) {
      const cells = splitRow(line);
      if (currentExamples) {
        if (currentExamples.headers.length === 0) currentExamples.headers = cells;
        else currentExamples.rows.push(cells);
        continue;
      }
      const step = lastStep();
      if (step) {
        step.dataTable = [...(step.dataTable ?? []), cells];
        continue;
      }
      feature.unparsed.push({ line: lineNo, text: line });
      continue;
    }

    let m = /^(Feature|Ability|Business Need):\s*(.*)$/i.exec(line);
    if (m) {
      feature.name = m[2]!.trim() || feature.name;
      feature.tags = pendingTags;
      pendingTags = [];
      inFeatureDescription = true;
      target = 'none';
      continue;
    }

    m = /^(Background):\s*(.*)$/i.exec(line);
    if (m) {
      target = 'background';
      currentExamples = undefined;
      inFeatureDescription = false;
      lastKeyword = 'Given';
      continue;
    }

    m = /^(Scenario Outline|Scenario Template|Scenario|Example):\s*(.*)$/i.exec(line);
    if (m) {
      current = {
        name: m[2]!.trim() || `scenario at line ${lineNo}`,
        tags: pendingTags,
        steps: [],
        isOutline: /Outline|Template/i.test(m[1]!),
        examples: [],
        line: lineNo,
      };
      feature.scenarios.push(current);
      pendingTags = [];
      target = 'scenario';
      currentExamples = undefined;
      inFeatureDescription = false;
      lastKeyword = 'Given';
      continue;
    }

    m = /^(Examples|Scenarios):\s*(.*)$/i.exec(line);
    if (m) {
      currentExamples = { name: m[2]!.trim() || undefined, tags: pendingTags, headers: [], rows: [], line: lineNo };
      if (current) current.examples.push(currentExamples);
      pendingTags = [];
      continue;
    }

    // A step.
    const keyword = KEYWORDS.find((k) => line.startsWith(`${k} `) || line === k);
    if (keyword) {
      const text = line.slice(keyword.length).trim();
      const effective: GherkinStep['keyword'] =
        keyword === 'And' || keyword === 'But' || keyword === '*'
          ? lastKeyword
          : (keyword as GherkinStep['keyword']);
      lastKeyword = effective;
      currentExamples = undefined;
      pushStep({ keyword: effective, writtenKeyword: keyword, text, line: lineNo });
      continue;
    }

    if (inFeatureDescription) {
      feature.description += (feature.description ? '\n' : '') + line;
      continue;
    }

    if (current && current.steps.length === 0) {
      current.description = (current.description ? `${current.description}\n` : '') + line;
      continue;
    }

    feature.unparsed.push({ line: lineNo, text: line });
  }

  return feature;
}

/** Recursively collect `.feature` files. */
export function findFeatureFiles(dir: string, acc: string[] = []): string[] {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'target' || entry.name === 'build' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) findFeatureFiles(full, acc);
    else if (entry.name.endsWith('.feature')) acc.push(full);
  }
  return acc;
}

/** Substitute `<placeholder>` from an Examples row into a step's text. */
export function substituteOutline(text: string, headers: string[], row: string[]): string {
  let out = text;
  headers.forEach((header, i) => {
    out = out.split(`<${header}>`).join(row[i] ?? '');
  });
  return out;
}

/** The `<placeholder>` names used anywhere in a scenario. */
export function placeholdersIn(scenario: GherkinScenario): string[] {
  const found = new Set<string>();
  for (const step of scenario.steps) {
    for (const m of step.text.matchAll(/<([^>]+)>/g)) found.add(m[1]!);
  }
  return [...found];
}
