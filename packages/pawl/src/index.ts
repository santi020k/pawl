/**
 * @santi020k/pawl
 *
 * Fast guardrails for AI-written code. One standard, compiled for Biome and ESLint.
 */
export type { Baseline, BaselineResult, Suppression } from './baseline.ts'
export { applyBaseline, BASELINE_FILE, createBaseline, readBaseline, scanSuppressions } from './baseline.ts'
export type { CheckOptions, CheckResult } from './check.ts'
export { check, EXIT_FINDINGS, EXIT_OK, EXIT_SETUP, exitCode } from './check.ts'
export type { Detection, Framework, PackageManager, WorkspaceTool } from './detect.ts'
export {
  allTechnologies,
  describe,
  detect,
  needsEslint,
  packageTechnologies,
  technologies,
  usesReact
} from './detect.ts'
export type { BiomeContext } from './engines/biome.ts'
export {
  BIOME_PRESET,
  BIOME_REACT_PRESET,
  BIOME_VERSION,
  biomeConfig,
  biomePackageConfig,
  biomeProjectConfig,
  biomeTechConfig,
  biomeTechPreset,
  checkBiomeConfig
} from './engines/biome.ts'
export type { EslintOptions, EslintPlan, EslintPlanOptions, FlatConfig } from './engines/eslint.ts'
export { eslint, eslintPlan, eslintPlanFor } from './engines/eslint.ts'
export { checkOxlintConfig, oxlintConfig, oxlintCovers } from './engines/oxlint.ts'
export { OXLINT_RULES, OXLINT_VERSION } from './engines/oxlint-rules.ts'
export { checkPrettierConfig, prettierConfig } from './engines/prettier.ts'
export type { InitAction, InitMode, InitOptions, InitPlan } from './init.ts'
export { applyInit, formatWritten, planAdd, planInit, planPrettierConfig, recordBaseline } from './init.ts'
export type { MigrateOptions, MigratePlan, RuleChange } from './migrate.ts'
export { describeMigration, MIGRATION_REPORT, planMigrate } from './migrate.ts'
export type { OutputFormat } from './output.ts'
export { format, formatAgent, formatJson, formatPretty } from './output.ts'
export type { Pack } from './packs.ts'
export { getPack, PACKS, suggestedPacks } from './packs.ts'
export type { RuleContext } from './policy.ts'
export {
  DEFAULT_STYLE,
  defaultPolicy,
  definePolicy,
  effectiveRules,
  loadPolicy,
  mergeLayers,
  resolvePolicy
} from './policy.ts'
export type { RuleDef, RuleTag, Technology } from './rules.ts'
export { canonicalName, findRule, GATED_TAGS, getRule, RULES } from './rules.ts'
export type { Toolset } from './tools.ts'
export { toolset } from './tools.ts'
export type {
  EngineChoice,
  EngineName,
  Finding,
  FormatterChoice,
  FormatterName,
  Level,
  LockViolation,
  Policy,
  PolicyInput,
  SetupIssue,
  StyleOptions
} from './types.ts'
export { VERSION } from './version.ts'
