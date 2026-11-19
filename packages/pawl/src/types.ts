/** Severity a rule runs at. */
export type Level = 'off' | 'warn' | 'error'

/** Engines pawl can compile a policy for. */
export type EngineName = 'biome' | 'oxlint' | 'eslint'

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

/** What a user or a company writes in `pawl.config.ts` or a policy package. */
export interface PolicyInput {
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
  style?: Partial<StyleOptions>
  /**
   * Rule levels by neutral name (ESLint's names). `biome:group/name` reaches a Biome-only rule,
   * and any other unknown name is passed to ESLint as is.
   */
  rules?: Record<string, Level>
  /**
   * Options for rules, in ESLint's own shape, by the same names as `rules`.
   * ESLint and Oxlint take them. Biome has its own option shapes and ignores them.
   */
  options?: Record<string, readonly unknown[]>
  /** Rules that later layers may tighten but never loosen. */
  locked?: readonly string[]
  /** Extra glob patterns to skip. */
  ignore?: readonly string[]
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
  locked: string[]
  ignore: string[]
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
  engine: EngineName | 'prettier' | 'pawl'
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
  message: string
  fix?: string
}
