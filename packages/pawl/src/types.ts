import { type Language } from './languages.ts'

/** Severity a rule runs at. */
export type Level = 'off' | 'warn' | 'error'

/** Engines pawl can compile a policy for. */
export type EngineName = 'biome' | 'oxlint' | 'eslint'

/**
 * The tools of other languages, which pawl runs with the project's own config. `rustc` is the
 * Rust compiler, whose warnings arrive with Clippy's.
 */
export type LanguageEngine = 'clippy' | 'rustc' | 'rustfmt' | 'swiftlint' | 'swiftformat' | 'swift-format' | 'ktlint'

/** Which of a language's tools run: its linter, its formatter, or both. */
export interface LanguageTools {
  lint: boolean
  format: boolean
}

/** The languages to check, by name, or with some of their tools turned off. */
export type LanguagesInput = readonly Language[] | Partial<Record<Language, boolean | Partial<LanguageTools>>>

export type EngineChoice = 'auto' | EngineName

/** Tools that can format. Biome also lints; Prettier only formats. */
export type FormatterName = 'biome' | 'prettier'

export type FormatterChoice = 'auto' | FormatterName

/** The formatting style. Kept deliberately small. */
export interface StyleOptions {
  indent: 2 | 4 | 'tab'
  lineWidth: number
  quotes: 'single' | 'double'
  semicolons: boolean
  trailingCommas: 'none' | 'all'
  arrowParens: 'as-needed' | 'always'
}

/** Where the code runs. Each one brings the global variables that runtime defines. */
export type Runtime = 'node' | 'browser' | 'bun' | 'deno' | 'worker'

/** A framework or library pawl recognises from the dependencies or the files. */
export type Framework =
  | 'react'
  | 'next'
  | 'vue'
  | 'nuxt'
  | 'svelte'
  | 'angular'
  | 'astro'
  | 'solid'
  | 'react-native'
  | 'qwik'
  | 'tailwind'
  | 'tanstack-query'
  | 'drizzle'
  | 'playwright'
  | 'hono'
  | 'lit'
  | 'nest'
  | 'preact'
  | 'react-router'
  | 'tanstack-start'
  | 'vite'

/** What detection can be told to leave out: a framework, Turborepo's rules, or another language. */
export type Detectable = Framework | 'turbo' | Language

/** Rule levels and options for some files only. */
export interface OverrideInput {
  /** Glob patterns of the files. A pattern without a slash matches at any depth. */
  files: readonly string[]
  /** Rule levels for those files, by the same names as the policy's `rules`. */
  rules?: Record<string, Level>
  /** Rule options for those files, in ESLint's shape. ESLint and Oxlint take them. */
  options?: Record<string, readonly unknown[]>
  /** Rule options for those files, in Biome's shape. Only Biome takes them. */
  biomeOptions?: Record<string, Record<string, unknown>>
}

/** What a user or a company writes in `pawl.config.ts` or a policy package. */
export interface PolicyInput {
  /** The JSON schema of the file, for editors. Pawl ignores it. */
  $schema?: string
  /** Other policies to build on: a package name, a relative path, or an inline policy. */
  extends?: string | PolicyInput | readonly (string | PolicyInput)[]
  /** Which engine lints and formats. `auto` picks from what the repo already uses. */
  engine?: EngineChoice
  /** Which tool formats. `auto` is Biome, unless the repo lints with ESLint and already has Prettier. */
  formatter?: FormatterChoice
  /** Optional packs to switch on by name. Packs for what the project depends on switch on by themselves. */
  packs?: readonly string[]
  /** Turn on the stricter level of every rule that has one. A later layer cannot turn it off. */
  strict?: boolean
  /** Fail the check when there are more new warnings than this. A later layer can lower it, not raise it. */
  maxWarnings?: number
  style?: Partial<StyleOptions>
  /**
   * Rule levels by neutral name (ESLint's names). `biome:group/name` reaches a Biome-only rule,
   * and any other unknown name is passed to ESLint as is.
   */
  rules?: Record<string, Level>
  /**
   * Options for rules, in ESLint's own shape, by the same names as `rules`.
   * ESLint and Oxlint take them. Biome has its own option shapes: see `biomeOptions`.
   */
  options?: Record<string, readonly unknown[]>
  /**
   * Options for Biome's rules, in Biome's own shape, by the same names as `rules`.
   * They replace the options the standard gives the rule. Only Biome takes them.
   */
  biomeOptions?: Record<string, Record<string, unknown>>
  /** Rule levels and options for some files only, such as tests. Later entries win. */
  overrides?: readonly OverrideInput[]
  /** Rules that later layers may tighten but never loosen. */
  locked?: readonly string[]
  /** Extra glob patterns to skip. A pattern without a slash matches at any depth. */
  ignore?: readonly string[]
  /** Skip what the root .gitignore lists. On by default. */
  gitignore?: boolean
  /** Skip build output, caches, lockfiles, AI tool folders and generated code. On by default. */
  defaultIgnores?: boolean
  /** Where the code runs, instead of what pawl detects. Sets the global variables the linters know. */
  runtime?: Runtime | readonly Runtime[]
  /**
   * Work out the technologies from the dependencies and files. On by default.
   * `false` turns detection off; `{ exclude }` leaves some technologies out.
   */
  detect?: boolean | { exclude?: readonly Detectable[] }
  /**
   * Other languages to check with their own tools: Rust with Clippy and rustfmt, Swift with
   * SwiftLint and SwiftFormat or swift-format, Kotlin with ktlint. Off unless named, so a repo that already
   * checks them another way, such as with Quality, does not check them twice.
   */
  languages?: LanguagesInput
}

/** An override, merged. */
export interface Override {
  files: string[]
  rules: Record<string, Level>
  options: Record<string, unknown[]>
  biomeOptions: Record<string, Record<string, unknown>>
}

/** A later layer tried to loosen a locked rule. The stricter level was kept. */
export interface LockViolation {
  rule: string
  wanted: Level
  kept: Level
  source: string
}

/** A fully merged policy. */
export interface Policy {
  engine: EngineChoice
  formatter: FormatterChoice
  packs: string[]
  strict: boolean
  style: StyleOptions
  /** Explicit overrides only. Use `effectiveRules` for the level of every rule. */
  rules: Record<string, Level>
  /** Options by rule, in ESLint's shape. */
  options: Record<string, unknown[]>
  /** Options by rule, in Biome's shape. */
  biomeOptions: Record<string, Record<string, unknown>>
  overrides: Override[]
  locked: string[]
  ignore: string[]
  gitignore: boolean
  defaultIgnores: boolean
  /** The runtimes the policy names, or undefined to use what pawl detects. */
  runtime: Runtime[] | undefined
  /** Detection on, off, or with some technologies left out. */
  detect: { enabled: boolean; exclude: Detectable[] }
  /** The other languages pawl checks, and which of their tools run. */
  languages: Partial<Record<Language, LanguageTools>>
  /** Undefined means warnings never fail the check. */
  maxWarnings: number | undefined
  lockViolations: LockViolation[]
  /** Where each layer came from, defaults first. */
  sources: string[]
}

/** One problem found by an engine or by pawl itself, in a shape every output format shares. */
export interface Finding {
  /** Path relative to the project root, with forward slashes. */
  file: string
  line: number
  column: number
  engine: EngineName | LanguageEngine | 'prettier' | 'pawl'
  /** The rule name as the engine reports it. */
  engineRule: string
  /** The neutral name when the rule is in the catalog, else `engine:rule`. */
  rule: string
  severity: 'warn' | 'error'
  message: string
  fixable: boolean
  /** Set when the baseline allows some of this rule in this file but more were found. */
  overBaseline?: { allowed: number; found: number }
}

/** Something wrong with the setup, as opposed to the code. */
export interface SetupIssue {
  code:
    | 'biome-config-missing'
    | 'biome-config-stale'
    | 'biome-config-foreign'
    | 'eslint-missing'
    | 'oxlint-missing'
    | 'oxlint-config-missing'
    | 'oxlint-config-stale'
    | 'prettier-missing'
    | 'prettier-config-missing'
    | 'prettier-config-stale'
    | 'pack-missing'
    | 'locked-rule'
    | 'engine-failed'
    | 'language-tool-missing'
    | 'since-unresolved'
  message: string
  fix?: string
}
