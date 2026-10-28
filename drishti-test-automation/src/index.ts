/**
 * Public surface of the framework.
 *
 * Specs normally need only `test` and `expect` from `fixtures/index.js`;
 * this barrel exists for tooling, page objects and anything extending the
 * framework.
 */

// Test surface
export { test, expect, describe, beforeEach, afterEach, step } from './fixtures/index.js';
export type { AiFixtures } from './fixtures/index.js';
export { SmartPage } from './fixtures/smart-page.js';
export type { Finder } from './fixtures/smart-page.js';
export { BasePage } from './pages/base.page.js';

// Locator repository
export {
  LocatorRepository,
  getRepository,
  resetRepository,
  UnknownElementError,
} from './locators/repository.js';
export type { ResolvedElement } from './locators/repository.js';
export { buildDefinition, buildChain, applyStep, explain } from './locators/resolver.js';
export { parseLocatorFile, normalizeDefinition, describeSteps } from './locators/schema.js';
export { persistHeal, renderLocatorFile } from './locators/writer.js';

// Healing
export { resolveWithHealing, healRecords, ElementNotFoundError } from './ai/healer.js';
export type { HealContext, HealOutcome } from './ai/healer.js';

// DOM capture and deterministic matching
export { capturePage, captureCandidates, captureAria, renderCandidates } from './dom/snapshot.js';
export type { PageSnapshot } from './dom/snapshot.js';
export { rankCandidates, hasClearWinner, buildIntent, stepsForCandidate } from './dom/candidates.js';

// AI capabilities
export { scanUrl, scanPage } from './ai/scanner.js';
export { generateTest } from './ai/generator.js';
export { analyzeFailure, renderAnalysisReport } from './ai/analyzer.js';
export { usageLedger, usageSummary } from './ai/client.js';

// Reporting
export { default as AiReporter } from './reporting/ai-reporter.js';

// Environments and test data
export {
  getEnvironment,
  getEnvironmentByName,
  storageStatePath,
  assertWritable,
  loadEnvFiles,
  ENVIRONMENT_NAMES,
} from '../config/environments.js';
export type { EnvironmentConfig, UserCredentials } from '../config/environments.js';
export { getDataset, datasetSchema, resetDatasetCache } from './data/dataset.js';
export type { Dataset } from './data/dataset.js';
export { factory } from './data/factory.js';
export type { Factory, TodoSeed, UserSeed, OrderSeed, AddressSeed } from './data/factory.js';
export { runId, runTag, unique, uniqueEmail, isQaGenerated, runIdOf } from './data/run.js';
export { AppState, seedTodos } from './data/app-state.js';
export { Seeder, NoApiConfiguredError } from './data/seeder.js';

// Configuration and types
export { getConfig, loadConfig, hasCredentials } from './core/config.js';
export type { AiqaConfig } from './core/config.js';
export { createLogger } from './core/logger.js';
export type {
  AriaRole,
  DomCandidate,
  FailureAnalysis,
  HealRecord,
  LocatorDefinition,
  LocatorFile,
  LocatorFilter,
  LocatorStep,
  StrategyName,
} from './core/types.js';
