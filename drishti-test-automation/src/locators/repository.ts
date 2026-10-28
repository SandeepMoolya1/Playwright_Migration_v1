/**
 * The locator repository: loads every `*.locators.yml` under `locatorsDir`
 * and exposes them as `file.element` keys.
 *
 * Files are read once per process and cached. Tests reference elements by
 * dotted key (`login.usernameInput`), so a rename in YAML surfaces as a clear
 * "unknown element" error listing near-matches, not a mystery timeout.
 */
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { getConfig } from '../core/config.js';
import { createLogger } from '../core/logger.js';
import { parseLocatorFile } from './schema.js';
import type { LocatorDefinition, LocatorFile } from '../core/types.js';

const log = createLogger('locators');

export interface ResolvedElement {
  /** Dotted key, e.g. `login.usernameInput`. */
  key: string;
  /** Logical file name, e.g. `login`. */
  file: string;
  /** Element name within the file. */
  element: string;
  /** Absolute path to the YAML source. */
  sourcePath: string;
  definition: LocatorDefinition;
  meta: LocatorFile['meta'];
}

export class UnknownElementError extends Error {
  constructor(key: string, suggestions: string[]) {
    const hint = suggestions.length
      ? `\n  Did you mean:\n${suggestions.map((s) => `    - ${s}`).join('\n')}`
      : '\n  No locator files loaded. Check `locatorsDir` in aiqa.config.ts.';
    super(`Unknown locator "${key}".${hint}`);
    this.name = 'UnknownElementError';
  }
}

export class LocatorRepository {
  private readonly files = new Map<string, { file: LocatorFile; sourcePath: string }>();
  private loaded = false;

  constructor(private readonly dir: string = getConfig().locatorsDir) {}

  /** Walk `dir` recursively and parse every locator file found. */
  load(force = false): this {
    if (this.loaded && !force) return this;
    this.files.clear();

    if (!fs.existsSync(this.dir)) {
      log.warn(`locators directory not found: ${this.dir}`);
      this.loaded = true;
      return this;
    }

    for (const sourcePath of walk(this.dir)) {
      const base = path.basename(sourcePath);
      try {
        const data = YAML.parse(fs.readFileSync(sourcePath, 'utf8')) as unknown;
        if (!data) continue;
        const parsed = parseLocatorFile(data, base);
        // Namespace by the declared meta.name, falling back to the file stem,
        // so `pages/login.locators.yml` is addressed as `login.*`.
        const ns = parsed.meta.name;
        if (this.files.has(ns)) {
          log.warn(`duplicate locator namespace "${ns}" (${sourcePath}) — later file wins`);
        }
        this.files.set(ns, { file: parsed, sourcePath });
      } catch (err) {
        throw new Error(`Failed to load locator file ${sourcePath}: ${(err as Error).message}`);
      }
    }

    this.loaded = true;
    log.debug(`loaded ${this.files.size} locator file(s) from ${this.dir}`);
    return this;
  }

  /** Resolve a dotted key into its definition and provenance. */
  get(key: string): ResolvedElement {
    this.load();
    const dot = key.indexOf('.');
    if (dot === -1) throw new UnknownElementError(key, this.suggest(key));

    const file = key.slice(0, dot);
    const element = key.slice(dot + 1);
    const entry = this.files.get(file);
    const definition = entry?.file.elements[element];
    if (!entry || !definition) throw new UnknownElementError(key, this.suggest(key));

    return {
      key,
      file,
      element,
      sourcePath: entry.sourcePath,
      definition,
      meta: entry.file.meta,
    };
  }

  has(key: string): boolean {
    this.load();
    const dot = key.indexOf('.');
    if (dot === -1) return false;
    return Boolean(this.files.get(key.slice(0, dot))?.file.elements[key.slice(dot + 1)]);
  }

  /** Every dotted key in the repository, sorted. */
  keys(): string[] {
    this.load();
    const out: string[] = [];
    for (const [ns, { file }] of this.files) {
      for (const element of Object.keys(file.elements)) out.push(`${ns}.${element}`);
    }
    return out.sort();
  }

  namespaces(): string[] {
    this.load();
    return [...this.files.keys()].sort();
  }

  fileOf(namespace: string): { file: LocatorFile; sourcePath: string } | undefined {
    this.load();
    return this.files.get(namespace);
  }

  /**
   * Apply a healed definition in memory so the rest of the run uses it.
   * Persistence to disk is the writer's job.
   */
  patch(key: string, definition: LocatorDefinition): void {
    const { file, element } = this.get(key);
    const entry = this.files.get(file);
    if (entry) entry.file.elements[element] = definition;
  }

  private suggest(key: string): string[] {
    const all = this.keys();
    const target = key.toLowerCase();
    return all
      .map((k) => ({ k, d: distance(k.toLowerCase(), target) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 5)
      .filter((x) => x.d <= Math.max(4, Math.floor(target.length / 2)))
      .map((x) => x.k);
  }
}

function* walk(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.locators\.ya?ml$/.test(entry.name) || /\.ya?ml$/.test(entry.name)) yield full;
  }
}

/** Levenshtein distance, used only for "did you mean" hints. */
function distance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const cur = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j]!;
  }
  return prev[b.length]!;
}

let shared: LocatorRepository | undefined;

/** Process-wide repository shared by fixtures, healer and CLI. */
export function getRepository(): LocatorRepository {
  if (!shared) shared = new LocatorRepository().load();
  return shared;
}

export function resetRepository(): void {
  shared = undefined;
}
