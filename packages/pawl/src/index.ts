/**
 * @santi020k/pawl
 *
 * Fast guardrails for AI-written code. One standard, compiled for Biome and ESLint.
 */

export type { Pack } from './catalog/packs.ts'
export { getPack, PACKS, suggestedPacks } from './catalog/packs.ts'
export type { RuleDef, RuleTag, Technology } from './catalog/rules.ts'
export { canonicalName, findRule, GATED_TAGS, getRule, RULES } from './catalog/rules.ts'
export { RUNTIMES } from './catalog/runtimes.ts'
export type { Baseline, BaselineResult, Suppression } from './check/baseline.ts'
export { applyBaseline, BASELINE_FILE, createBaseline, readBaseline, scanSuppressions } from './check/baseline.ts'
export type { CheckOptions } from './check/check.ts'
export { check } from './check/check.ts'
export type { OutputFormat } from './check/output.ts'
export { format, formatAgent, formatJson, formatPretty } from './check/output.ts'
export type { CheckReport, CheckReportRead, ReadCheckReportOptions } from './check/report-contract.ts'
export { CHECK_REPORT_VERSION, readCheckReport } from './check/report-contract.ts'
export type { CheckResult } from './check/result.ts'
export { EXIT_FINDINGS, EXIT_OK, EXIT_SETUP, exitCode } from './check/result.ts'
export type { BiomeContext } from './engines/biome/config.ts'
export {
  BIOME_PRESET,
  BIOME_VERSION,
  biomeConfig,
  biomePackageConfig,
  biomeProjectConfig,
  biomeTechConfig,
  biomeTechPreset
} from './engines/biome/config.ts'
export { checkBiomeConfig } from './engines/biome/state.ts'
export type {
  EslintIntegrationOptions,
  EslintOptions,
  EslintPlan,
  EslintPlanOptions,
  FlatConfig,
  PackageScope
} from './engines/eslint/plan.ts'
export { eslint, eslintPlan, eslintPlanFor } from './engines/eslint/plan.ts'
export type { LanguageCheckOptions, LanguageCheckResult } from './engines/languages/check.ts'
export { checkLanguages } from './engines/languages/check.ts'
export type { OxlintContext } from './engines/oxlint/config.ts'
export { checkOxlintConfig, oxlintConfig, oxlintCovers } from './engines/oxlint/config.ts'
export { OXLINT_RULES, OXLINT_VERSION } from './engines/oxlint/rules.ts'
export { checkPrettierConfig, prettierConfig } from './engines/prettier/config.ts'
export type { RuleContext } from './policy/levels.ts'
export { effectiveRules } from './policy/levels.ts'
export { findProjectRoot, loadPolicy, resolvePolicy } from './policy/load.ts'
export { DEFAULT_STYLE, defaultPolicy, definePolicy, mergeLayers } from './policy/merge.ts'
export type { Project } from './policy/project.ts'
export { loadProject } from './policy/project.ts'
export type { JsonSchema } from './policy/schema.ts'
export { POLICY_KEYS, POLICY_SCHEMA } from './policy/schema.ts'
export type { Detection, DetectOptions, FileFormat, PackageManager, WorkspaceTool } from './project/detect.ts'
export {
  allTechnologies,
  DETECTABLE,
  describe,
  detect,
  filePacks,
  needsEslint,
  packageTechnologies,
  technologies
} from './project/detect.ts'
export { ALWAYS_IGNORED, DEFAULT_IGNORES } from './project/ignores.ts'
export type { Language, LanguageInfo, LanguageProject } from './project/languages.ts'
export { LANGUAGE_INFO, LANGUAGES } from './project/languages.ts'
export type { LintOverlap, LintTool, LintTraversal, LintTraversalReport } from './project/lint-traversal.ts'
export { analyzeLintTraversal } from './project/lint-traversal.ts'
export type {
  TaskCache,
  TaskConsumer,
  TaskFile,
  TaskFileReachability,
  TaskReachability
} from './project/task-reachability.ts'
export { analyzeTaskReachability } from './project/task-reachability.ts'
export type { Toolset } from './project/toolset.ts'
export { toolset } from './project/toolset.ts'
export type { Compatibility, DoctorReport } from './report/doctor.ts'
export { doctor, formatDoctor } from './report/doctor.ts'
export { explainRule } from './report/explain.ts'
export { planAdd } from './setup/add.ts'
export type { InitMode, InitOptions, InitPlan } from './setup/init.ts'
export { formatWritten, planInit, recordBaseline } from './setup/init.ts'
export type { MigrateOptions, MigratePlan, RuleChange } from './setup/migrate/migration.ts'
export { MIGRATION_REPORT } from './setup/migrate/migration.ts'
export { planMigrate } from './setup/migrate/plan.ts'
export { describeMigration } from './setup/migrate/report.ts'
export type { SetupAction, SetupPlan } from './setup/plan.ts'
export { applyPlan } from './setup/plan.ts'
export type { SyncPlan } from './setup/sync.ts'
export { planSync } from './setup/sync.ts'
export type {
  Detectable,
  EngineChoice,
  EngineName,
  Finding,
  FormatterChoice,
  FormatterName,
  Framework,
  LanguageEngine,
  LanguagesInput,
  LanguageTools,
  Level,
  LockViolation,
  Override,
  OverrideInput,
  Policy,
  PolicyInput,
  Runtime,
  SetupIssue,
  StyleOptions,
  TestRunner
} from './types.ts'
export { satisfies } from './utils/semver.ts'
export { VERSION } from './version.ts'
