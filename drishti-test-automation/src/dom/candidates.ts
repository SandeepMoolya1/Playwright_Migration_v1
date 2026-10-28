/**
 * Deterministic candidate ranking — the tier that runs before any AI call.
 *
 * Most locator breakage is small: a renamed test id, a label that gained a
 * word, a class that changed. Scoring live candidates against the element's
 * declared intent fixes those in milliseconds, offline and free. The model is
 * only worth paying for when this tier has no clear winner.
 *
 * Three signal families, in order of trustworthiness:
 *   1. Identifiers (test id, id, name attribute) — drift least.
 *   2. Accessible name — what `getByRole` matches on.
 *   3. Kind — the role the description implies ("button", "text field"),
 *      which is decisive when the page holds exactly one element of that kind.
 *
 * Nothing here is accepted on score alone: the healer validates every
 * proposal against the live page and requires a clear margin over the
 * runner-up before it uses one.
 */
import type { DomCandidate, LocatorDefinition, LocatorStep } from '../core/types.js';

/** Split identifiers and prose into comparable lowercase tokens. */
export function tokenize(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2') // camelCase -> camel Case
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .toLowerCase()
    .split(' ')
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

/** Prose connectives carry no matching signal and dilute the scores. */
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'that', 'this', 'these', 'those',
  'of', 'to', 'in', 'on', 'at', 'by', 'for', 'with', 'from', 'as', 'it',
  'its', 'and', 'or', 'but', 'then', 'than', 'so', 'if', 'when', 'where',
  'which', 'who', 'all', 'any', 'be', 'been', 'has', 'have', 'had', 'will',
  'can', 'each', 'e', 'g', 'eg', 'ie', 'etc',
]);

/**
 * Token equality with light stemming: `count` matches `counter`, `item`
 * matches `items`. Requires 4+ characters so short tokens stay exact.
 */
function tokensMatch(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length >= 4 && b.startsWith(a)) return true;
  if (b.length >= 4 && a.startsWith(b)) return true;
  return false;
}

function hits(intent: string[], target: string[]): number {
  let n = 0;
  for (const t of target) if (intent.some((i) => tokensMatch(i, t))) n++;
  return n;
}

/**
 * Blend of precision (how much of the candidate's label the intent explains)
 * and recall (how much of the intent the candidate accounts for). Precision
 * is weighted higher: a two-word button fully explained by the intent is a
 * better signal than a long description partially covered.
 */
function affinity(intent: string[], target: string[]): number {
  if (!intent.length || !target.length) return 0;
  const h = hits(intent, target);
  if (h === 0) return 0;
  const precision = h / target.length;
  const recall = h / intent.length;
  return 0.65 * precision + 0.35 * recall;
}

export interface Intent {
  /** Short, high-signal tokens: the element key and its original matchers. */
  core: string[];
  /** Supporting tokens from the human description. */
  context: string[];
  /** Roles the declaration or the description implies. */
  roles: Set<string>;
}

/** Words that reliably imply an ARIA role. */
const ROLE_WORDS: Array<[RegExp, string]> = [
  [/\b(button|cta|submit|btn)\b/, 'button'],
  [/\b(link|anchor|hyperlink)\b/, 'link'],
  [/\b(text ?field|text ?box|textbox|input|field|search ?box)\b/, 'textbox'],
  [/\b(search)\b/, 'searchbox'],
  [/\b(checkbox|check ?box|tick ?box)\b/, 'checkbox'],
  [/\b(radio)\b/, 'radio'],
  [/\b(dropdown|drop ?down|select|combo ?box|picker)\b/, 'combobox'],
  [/\b(heading|title|header)\b/, 'heading'],
  [/\b(table|grid)\b/, 'table'],
  [/\b(row|record)\b/, 'row'],
  [/\b(list)\b/, 'list'],
  [/\b(item|entry)\b/, 'listitem'],
  [/\b(tab)\b/, 'tab'],
  [/\b(dialog|modal|popup)\b/, 'dialog'],
  [/\b(alert|error|warning|banner|toast|notification)\b/, 'alert'],
  [/\b(image|icon|logo|avatar)\b/, 'img'],
  [/\b(toggle|switch)\b/, 'switch'],
];

/** Roles that are near-substitutes when the markup differs from the intent. */
const ROLE_KINSHIP: Record<string, string[]> = {
  button: ['link', 'menuitem', 'tab', 'switch', 'checkbox'],
  link: ['button', 'menuitem', 'tab'],
  textbox: ['searchbox', 'combobox'],
  searchbox: ['textbox', 'combobox'],
  combobox: ['listbox', 'textbox'],
  checkbox: ['switch', 'menuitemcheckbox', 'button'],
  switch: ['checkbox'],
  radio: ['menuitemradio'],
  list: ['listitem', 'table', 'grid'],
  listitem: ['row', 'cell', 'generic'],
  row: ['listitem', 'cell'],
  table: ['grid', 'list'],
  heading: ['generic', 'paragraph'],
  alert: ['status', 'generic', 'paragraph'],
};

/** Everything we know about what the test was looking for. */
export function buildIntent(elementName: string, def: LocatorDefinition): Intent {
  const core = new Set<string>(tokenize(elementName));
  for (const step of def.steps) {
    for (const t of [...tokenize(step.name), ...tokenize(step.text)]) core.add(t);
    // Selector bodies often carry the original semantic name ("#login-submit").
    if (step.selector) for (const t of tokenize(step.selector)) core.add(t);
  }

  const context = tokenize(def.description);

  const roles = new Set<string>();
  for (let i = def.steps.length - 1; i >= 0; i--) {
    const role = def.steps[i]?.role;
    if (role) roles.add(role);
  }
  const prose = `${elementName} ${def.description ?? ''}`.toLowerCase();
  for (const [pattern, role] of ROLE_WORDS) if (pattern.test(prose)) roles.add(role);

  return { core: [...core], context, roles };
}

function roleAffinity(candidateRole: string, roles: Set<string>): number {
  if (!roles.size) return 0;
  if (roles.has(candidateRole)) return 1;
  for (const role of roles) {
    if (ROLE_KINSHIP[role]?.includes(candidateRole)) return 0.5;
  }
  return -0.5;
}

/**
 * Score one candidate, 0..1.
 *
 * Signals are measured against the *whole* intent (key plus description),
 * because the description is what this framework asks engineers to keep
 * accurate — an element whose identifiers were entirely replaced is
 * recoverable only from what a human wrote about it. The short, precise core
 * tokens then add a smaller top-up, and agreement between two independent
 * signals (identifier and accessible name) adds a little more.
 */
export function scoreCandidate(
  candidate: DomCandidate,
  intent: Intent,
  /** How many visible candidates share this candidate's role. */
  rolePopulation: number,
): number {
  const nameTokens = tokenize(candidate.name);
  const idTokens = [
    ...tokenize(candidate.testId),
    ...tokenize(candidate.id),
    ...tokenize(candidate.label),
    ...tokenize(candidate.placeholder),
  ];
  const textTokens = tokenize(candidate.text);

  const all = [...new Set([...intent.core, ...intent.context])];

  const idAffinity = affinity(all, idTokens);
  const nameAffinity = affinity(all, nameTokens);

  let score =
    idAffinity * 0.34 +
    nameAffinity * 0.3 +
    affinity(all, textTokens) * 0.07 +
    // Identifier and accessible name pointing at the same element is
    // considerably stronger than either on its own.
    Math.min(idAffinity, nameAffinity) * 0.1 +
    // Top-up for matching the high-signal tokens specifically.
    Math.max(affinity(intent.core, idTokens), affinity(intent.core, nameTokens)) * 0.05;

  const role = roleAffinity(candidate.role, intent.roles);
  score += role * 0.14;

  // Decisive signal: the intent names a kind of control, and the page holds
  // exactly one visible element of that kind. This is what recovers an
  // element whose every identifier and label was replaced.
  if (role === 1 && rolePopulation === 1) score = Math.max(score, 0.82);

  // Near-certainties.
  const coreJoined = intent.core.join(' ');
  if (coreJoined && nameTokens.join(' ') === coreJoined) score = Math.max(score, 0.95);
  if (candidate.testId && tokenize(candidate.testId).join(' ') === coreJoined) {
    score = Math.max(score, 0.95);
  }

  if (!candidate.visible) score -= 0.2;

  return Math.max(0, Math.min(1, score));
}

export interface RankedCandidate {
  candidate: DomCandidate;
  score: number;
  steps: LocatorStep[];
}

/**
 * Build the most durable chain for a candidate, in Playwright's own order of
 * preference: test id, then role+name, then label/placeholder, then CSS.
 */
export function stepsForCandidate(candidate: DomCandidate): LocatorStep[] {
  if (candidate.testId) return [{ strategy: 'testId', text: candidate.testId }];
  if (candidate.role && candidate.role !== 'generic' && candidate.name) {
    return [
      {
        strategy: 'role',
        role: candidate.role as LocatorStep['role'],
        name: candidate.name,
        exact: true,
      },
    ];
  }
  if (candidate.label) return [{ strategy: 'label', text: candidate.label, exact: true }];
  if (candidate.placeholder) {
    return [{ strategy: 'placeholder', text: candidate.placeholder, exact: true }];
  }
  if (candidate.name && candidate.tag !== 'div' && candidate.tag !== 'span') {
    return [{ strategy: 'text', text: candidate.name, exact: true }];
  }
  return [{ strategy: 'css', selector: candidate.ref }];
}

/** Rank every candidate for a broken element, best first. */
export function rankCandidates(
  elementName: string,
  def: LocatorDefinition,
  candidates: DomCandidate[],
  topN = 12,
): RankedCandidate[] {
  const intent = buildIntent(elementName, def);

  const population = new Map<string, number>();
  for (const c of candidates) {
    if (c.visible) population.set(c.role, (population.get(c.role) ?? 0) + 1);
  }

  const scored = candidates
    .map((candidate) => ({
      candidate,
      score: scoreCandidate(candidate, intent, population.get(candidate.role) ?? 0),
      steps: stepsForCandidate(candidate),
    }))
    .filter((r) => r.score > 0.15)
    .sort((a, b) => b.score - a.score);

  // Collapse candidates that resolve to the *same* locator. Every row of a
  // list yields `getByTestId('todo-item')`, and those are not competing
  // proposals — treating them as rivals would make the clear-winner rule
  // reject every collection.
  const byChain = new Map<string, RankedCandidate>();
  for (const entry of scored) {
    const signature = JSON.stringify(entry.steps);
    if (!byChain.has(signature)) byChain.set(signature, entry);
  }

  return [...byChain.values()].slice(0, topN);
}

/**
 * Is the top candidate an unambiguous winner?
 *
 * A heal is only safe when one candidate stands clearly apart. Two plausible
 * matches with similar scores means we do not know which control the test
 * meant — exactly the case where clicking the wrong one does damage, and
 * exactly where the AI tier earns its cost.
 */
export function hasClearWinner(ranked: RankedCandidate[], floor: number, margin = 1.25): boolean {
  const best = ranked[0];
  if (!best || best.score < floor) return false;
  const runnerUp = ranked[1];
  if (!runnerUp) return true;
  return best.score >= runnerUp.score * margin || best.score >= 0.9;
}
