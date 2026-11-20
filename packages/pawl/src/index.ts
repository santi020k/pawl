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
export type { CheckResult } from './check/result.ts'
export { EXIT_FINDINGS, EXIT_OK, EXIT_SETUP, exitCode } from './check/result.ts'
export type { BiomeContext } from './engines/biome/config.ts'
export {
  BIOME_PRESET,
  BIOME_REACT_PRESET,
  BIOME_VERSION,
  biomeConfig,
  biomePackageConfig,
  biomeProjectConfig,
  biomeTechConfig,
  biomeTechPreset
} from './engines/biome/config.ts'
export { checkBiomeConfig } from './engines/biome/state.ts'
export type { EslintOptions, EslintPlan, EslintPlanOptions, FlatConfig } from './engines/eslint/plan.ts'
export { eslint, eslintPlan, eslintPlanFor } from './engines/eslint/plan.ts'
export type { OxlintContext } from './engines/oxlint/config.ts'
export { checkOxlintConfig, oxlintConfig, oxlintCovers } from './engines/oxlint/config.ts'
export { OXLINT_RULES, OXLINT_VERSION } from './engines/oxlint/rules.ts'
export { checkPrettierConfig, prettierConfig } from './engines/prettier/config.ts'
export type { RuleContext } from './policy/load.ts'
export {
  DEFAULT_STYLE,
  defaultPolicy,
  definePolicy,
  effectiveRules,
  findProjectRoot,
  loadPolicy,
  mergeLayers,
  resolvePolicy
} from './policy/load.ts'
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
  technologies,
  usesReact
} from './project/detect.ts'
export { ALWAYS_IGNORED, DEFAULT_IGNORES } from './project/ignores.ts'
export type { Toolset } from './project/toolset.ts'
export { toolset } from './project/toolset.ts'
export type { Compatibility, DoctorReport } from './report/doctor.ts'
export { doctor, formatDoctor } from './report/doctor.ts'
export type { InitAction, InitMode, InitOptions, InitPlan } from './setup/init.ts'
export { applyInit, formatWritten, planAdd, planInit, planPrettierConfig, recordBaseline } from './setup/init.ts'
export type { MigrateOptions, MigratePlan, RuleChange } from './setup/migrate.ts'
export { describeMigration, MIGRATION_REPORT, planMigrate } from './setup/migrate.ts'
export type {
  Detectable,
  EngineChoice,
  EngineName,
  Finding,
  FormatterChoice,
  FormatterName,
  Framework,
  Level,
  LockViolation,
  Override,
  OverrideInput,
  Policy,
  PolicyInput,
  Runtime,
  SetupIssue,
  StyleOptions
} from './types.ts'
export { satisfies } from './utils/semver.ts'
export { VERSION } from './version.ts'
