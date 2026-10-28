#!/usr/bin/env node
/**
 * `aiqa` entry point.
 *
 * Runs the TypeScript CLI through tsx so the command works straight from a
 * clone with no build step — the framework is meant to be read and modified,
 * and a compile stage between an engineer and `aiqa doctor` is friction.
 * `npm run build` still emits a plain-JS `dist/` when you want one.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, '..', 'src', 'cli', 'index.ts');
const tsx = path.join(here, '..', 'node_modules', 'tsx', 'dist', 'cli.mjs');

// Launched through node itself: .bin/tsx is a .cmd shim on Windows and cannot be spawned directly.
const child = spawn(process.execPath, [tsx, entry, ...process.argv.slice(2)], {
  stdio: 'inherit',
  // The CLI resolves the repo root and the locators dir from cwd, so keep it.
  cwd: process.cwd(),
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
child.on('error', (err) => {
  console.error(`aiqa: could not start (${err.message}). Did you run \`npm install\`?`);
  process.exit(1);
});
