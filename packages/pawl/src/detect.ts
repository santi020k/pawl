import { type Dirent, existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isGitRepo, readJson, toPosix } from './fs-utils.ts'
import { ignoreMatcher, WALK_SKIP } from './ignores.ts'
import {
  isBuildFolder,
  LANGUAGE_INFO,
  LANGUAGES,
  type LanguageProject,
  languageIgnores,
  languageProjects,
  languagesOf,
  type Marker,
  markerLanguage,
  XCODE_BUNDLE
} from './languages.ts'
import { GATED_TAGS, type Technology } from './rules.ts'
import { type Detectable, type Framework, type Policy, type Runtime } from './types.ts'

export type { Framework } from './types.ts'

export type PackageManager = 'pnpm' | 'npm' | 'yarn' | 'bun'

export type WorkspaceTool = 'turbo' | 'nx'

/** A file format that has a pack of its own. */
export type FileFormat = 'markdown' | 'mdx' | 'yaml' | 'jsonc' | 'toml' | 'graphql'

/** Frameworks whose files Biome cannot fully lint yet, so ESLint still earns its place. */
export const NEEDS_ESLINT: readonly Framework[] = ['vue', 'nuxt', 'svelte', 'angular', 'astro']

export interface Detection {
  root: string
  git: boolean
  packageManager: PackageManager | undefined
  workspace: {
    tool: WorkspaceTool | undefined
    /** Package directories relative to the root. Empty for a single-package repo. */
    packages: string[]
    /** The frameworks each package depends on itself, by package directory. */
    frameworks: Record<string, Framework[]>
    /** The dependencies each package names itself, by package directory. */
    dependencies: Record<string, string[]>
  }
  /** The frameworks the root package.json depends on. */
  rootFrameworks: Framework[]
  /** The dependencies the root package.json names. */
  rootDependencies: string[]
  /** Projects in other languages, such as a Cargo workspace, an Xcode app or a Gradle build, by folder. */
  languages: LanguageProject[]
  /** Patterns to skip that detection found: the build folders of those projects. */
  ignores: string[]
  /** Where the code runs: what the policy names, else what the dependencies and files say. */
  runtimes: Runtime[]
  /** File formats found near the top of the repo, each of which a pack can lint. */
  formats: FileFormat[]
  /** What the policy told detection to leave out. */
  excluded: Detectable[]
  typescript: boolean
  /** Every dependency name in the root package.json and the workspace packages. */
  dependencies: string[]
  frameworks: Framework[]
  /** Config file of each tool found at the root, relative to it. */
  tools: {
    biome?: string
    eslint?: string
    oxlint?: string
    prettier?: string
    cspell?: string
    jsdoc?: string
  }
}

interface Manifest {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  workspaces?: string[] | { packages?: string[] }
  packageManager?: string
  prettier?: unknown
}

const FRAMEWORK_PACKAGES: readonly [string, Framework][] = [
  ['react', 'react'],
  ['next', 'next'],
  ['vue', 'vue'],
  ['nuxt', 'nuxt'],
  ['svelte', 'svelte'],
  ['@angular/core', 'angular'],
  ['astro', 'astro'],
  ['solid-js', 'solid'],
  ['react-native', 'react-native'],
  ['@builder.io/qwik', 'qwik'],
  ['@qwik.dev/core', 'qwik'],
  ['expo', 'react-native'],
  ['tailwindcss', 'tailwind'],
  ['@tanstack/react-query', 'tanstack-query'],
  ['@tanstack/vue-query', 'tanstack-query'],
  ['@tanstack/solid-query', 'tanstack-query'],
  ['@tanstack/svelte-query', 'tanstack-query'],
  ['drizzle-orm', 'drizzle'],
  ['@playwright/test', 'playwright'],
  ['hono', 'hono'],
  ['lit', 'lit'],
  ['lit-element', 'lit'],
  ['@nestjs/core', 'nest'],
  ['preact', 'preact'],
  ['react-router', 'react-router'],
  ['@react-router/dev', 'react-router'],
  ['@remix-run/react', 'react-router'],
  ['@remix-run/node', 'react-router'],
  ['@tanstack/react-start', 'tanstack-start'],
  ['@tanstack/solid-start', 'tanstack-start'],
  ['vite', 'vite']
]

/** Frameworks that run Vite themselves. Vite counts as a framework only without one of these. */
const VITE_HOSTS: readonly Framework[] = [
  'astro',
  'nuxt',
  'svelte',
  'qwik',
  'solid',
  'react-router',
  'tanstack-start',
  'angular',
  'next'
]

/** Frameworks whose code runs in a browser, so browser globals are defined. */
const FRONTEND: readonly Framework[] = [
  'react',
  'next',
  'vue',
  'nuxt',
  'svelte',
  'angular',
  'astro',
  'solid',
  'qwik',
  'preact',
  'lit',
  'react-router',
  'tanstack-start',
  'vite'
]

/** Frameworks for servers only. */
const SERVER: readonly Framework[] = ['nest', 'hono']

const TOOL_FILES = {
  biome: ['biome.json', 'biome.jsonc'],
  eslint: [
    'eslint.config.js',
    'eslint.config.mjs',
    'eslint.config.cjs',
    'eslint.config.ts',
    'eslint.config.mts',
    '.eslintrc',
    '.eslintrc.js',
    '.eslintrc.cjs',
    '.eslintrc.json',
    '.eslintrc.yml'
  ],
  oxlint: ['oxlint.config.ts', 'oxlint.config.mts', '.oxlintrc.json'],
  prettier: [
    '.prettierrc',
    '.prettierrc.json',
    '.prettierrc.js',
    '.prettierrc.cjs',
    '.prettierrc.mjs',
    '.prettierrc.yml',
    '.prettierrc.yaml',
    'prettier.config.js',
    'prettier.config.mjs',
    'prettier.config.cjs'
  ],
  cspell: [
    'cspell.json',
    '.cspell.json',
    'cSpell.json',
    'cspell.jsonc',
    '.cspell.jsonc',
    'cspell.config.json',
    'cspell.config.yaml',
    'cspell.config.yml',
    'cspell.config.js',
    'cspell.config.cjs',
    'cspell.config.mjs'
  ],
  jsdoc: ['jsdoc.json', '.jsdoc.json', 'jsdoc.config.js', 'jsdoc.config.cjs', 'jsdoc.config.mjs']
} as const

const TSCONFIG_FILES = ['tsconfig.json', 'tsconfig.base.json', 'tsconfig.app.json', 'tsconfig.node.json']

/** How far down the probe for file formats looks, and how many entries it reads at most. */
const PROBE_DEPTH = 4

const PROBE_LIMIT = 20_000

const FORMAT_EXTENSIONS: readonly [RegExp, FileFormat][] = [
  [/\.md$/i, 'markdown'],
  [/\.mdx$/i, 'mdx'],
  [/\.ya?ml$/i, 'yaml'],
  [/\.json[c5]$/i, 'jsonc'],
  [/\.toml$/i, 'toml'],
  [/\.(?:graphql|gql)$/i, 'graphql']
]

interface Probe {
  formats: Set<FileFormat>
  astro: boolean
  /** Files and folders that may mark a project in another language. */
  markers: Marker[]
}

/**
 * A shallow look at the files: which formats a pack could lint, Astro components, and the
 * manifests of projects in other languages. Folders nothing is checked in are skipped, and so
 * are hidden ones but `.github`, Xcode's bundles and the build folders of Cargo and Maven.
 */
const probeFiles = (root: string): Probe => {
  const probe: Probe = { formats: new Set(), astro: false, markers: [] }
  let budget = PROBE_LIMIT
  const visit = (dir: string, depth: number): void => {
    let entries: Dirent[]

    try {
      entries = readdirSync(join(root, dir), { withFileTypes: true })
    } catch {
      return
    }

    const names = entries.map(entry => entry.name)

    for (const entry of entries) {
      if (--budget < 0) return

      if (markerLanguage(entry.name, entry.isDirectory())) probe.markers.push({ dir, name: entry.name })

      if (entry.isDirectory()) {
        const hidden = entry.name.startsWith('.') && entry.name !== '.github'
        const skipped =
          hidden || WALK_SKIP.has(entry.name) || XCODE_BUNDLE.test(entry.name) || isBuildFolder(entry.name, names)

        if (depth < PROBE_DEPTH && !skipped) visit(toPosix(join(dir, entry.name)), depth + 1)
      } else if (entry.isFile()) {
        if (entry.name.endsWith('.astro')) probe.astro = true

        for (const [pattern, format] of FORMAT_EXTENSIONS) {
          if (pattern.test(entry.name)) probe.formats.add(format)
        }
      }
    }
  }

  visit('', 0)

  return probe
}

const BUN_PACKAGES = ['bun-types', '@types/bun']

const WORKER_PACKAGES = ['wrangler', '@cloudflare/workers-types', '@cloudflare/vitest-pool-workers']

/** Where the code runs, from the dependencies, the frameworks and a few config files. */
const detectRuntimes = (
  root: string,
  dependencies: ReadonlySet<string>,
  frameworks: readonly Framework[],
  hasManifest: boolean
): Runtime[] => {
  const has = (names: readonly string[]): boolean => names.some(name => existsSync(join(root, name)))
  const bun = BUN_PACKAGES.some(name => dependencies.has(name)) || has(['bunfig.toml'])
  const deno = has(['deno.json', 'deno.jsonc'])
  const worker =
    WORKER_PACKAGES.some(name => dependencies.has(name)) || has(['wrangler.toml', 'wrangler.json', 'wrangler.jsonc'])
  const frontend = frameworks.some(framework => FRONTEND.includes(framework))
  const server = frameworks.some(framework => SERVER.includes(framework))
  const runtimes: Runtime[] = []

  // Tooling runs on Node in any project with a package.json, so only a Deno project without one goes without.
  if (!deno || hasManifest) runtimes.push('node')

  // With nothing to say where the code runs, it may run anywhere, as before detection.
  if (frontend || !(bun || deno || worker || server)) runtimes.push('browser')

  if (bun) runtimes.push('bun')

  if (deno) runtimes.push('deno')

  if (worker) runtimes.push('worker')

  return runtimes
}

/**
 * Every framework, the Turborepo rules and the other languages: what `detect.exclude` takes,
 * and what `detect: false` leaves out.
 */
export const DETECTABLE: readonly Detectable[] = [
  ...new Set(FRAMEWORK_PACKAGES.map(([, framework]) => framework)),
  'turbo',
  ...LANGUAGES
]

const firstExisting = (root: string, names: readonly string[]): string | undefined =>
  names.find(name => existsSync(join(root, name)))

const detectPackageManager = (root: string, manifest: Manifest | undefined): PackageManager | undefined => {
  const declared = manifest?.packageManager?.split('@')[0]

  if (declared === 'pnpm' || declared === 'npm' || declared === 'yarn' || declared === 'bun') return declared

  if (existsSync(join(root, 'pnpm-lock.yaml')) || existsSync(join(root, 'pnpm-workspace.yaml'))) return 'pnpm'

  if (existsSync(join(root, 'bun.lock')) || existsSync(join(root, 'bun.lockb'))) return 'bun'

  if (existsSync(join(root, 'yarn.lock'))) return 'yarn'

  if (existsSync(join(root, 'package-lock.json'))) return 'npm'

  return manifest ? 'npm' : undefined
}

/** Read the `packages:` list of pnpm-workspace.yaml without a YAML dependency. */
const pnpmWorkspacePatterns = (root: string): string[] => {
  const file = join(root, 'pnpm-workspace.yaml')

  if (!existsSync(file)) return []

  const patterns: string[] = []
  let inPackages = false

  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (/^packages\s*:/.test(line)) {
      inPackages = true
    } else if (inPackages) {
      const item = /^\s+-\s+['"]?([^'"#]+?)['"]?\s*(?:#.*)?$/.exec(line)

      if (item?.[1]) patterns.push(item[1])
      else if (/^\S/.test(line)) inPackages = false
    }
  }

  return patterns
}

const expandPattern = (root: string, pattern: string): string[] => {
  if (pattern.startsWith('!')) return []

  const parts = pattern.replace(/\/$/, '').split('/')
  let dirs = ['']

  for (const part of parts) {
    const next: string[] = []

    for (const dir of dirs) {
      if (part === '*' || part === '**') {
        const base = join(root, dir)

        if (!existsSync(base)) continue

        for (const entry of readdirSync(base, { withFileTypes: true })) {
          if (entry.isDirectory() && entry.name !== 'node_modules' && !entry.name.startsWith('.'))
            next.push(join(dir, entry.name))
        }
      } else {
        next.push(join(dir, part))
      }
    }

    dirs = next
  }

  return dirs.filter(dir => existsSync(join(root, dir, 'package.json'))).map(toPosix)
}

const workspacePackages = (root: string, manifest: Manifest | undefined): string[] => {
  const fromManifest = Array.isArray(manifest?.workspaces)
    ? manifest.workspaces
    : (manifest?.workspaces?.packages ?? [])
  const patterns = [...pnpmWorkspacePatterns(root), ...fromManifest]

  return [...new Set(patterns.flatMap(pattern => expandPattern(root, pattern)))].sort()
}

const dependencyNames = (manifest: Manifest | undefined): string[] =>
  Object.keys({ ...manifest?.dependencies, ...manifest?.devDependencies, ...manifest?.peerDependencies })

const frameworksIn = (names: Iterable<string>): Framework[] => {
  const present = new Set(names)

  const found = [...new Set(FRAMEWORK_PACKAGES.filter(([name]) => present.has(name)).map(([, framework]) => framework))]

  // Vite on its own is a framework; under a framework that runs it, it is that framework's detail.
  return found.some(framework => VITE_HOSTS.includes(framework)) ? found.filter(name => name !== 'vite') : found
}

const detectWorkspaceTool = (root: string): WorkspaceTool | undefined => {
  if (existsSync(join(root, 'turbo.json')) || existsSync(join(root, 'turbo.jsonc'))) return 'turbo'

  return existsSync(join(root, 'nx.json')) ? 'nx' : undefined
}

const WORKSPACE_TOOL_NAMES: Record<WorkspaceTool, string> = { turbo: 'Turborepo', nx: 'Nx' }

/** What a policy says about detection, and the files it skips, which detection skips too. */
export type DetectOptions = Partial<Pick<Policy, 'detect' | 'runtime' | 'ignore' | 'gitignore' | 'defaultIgnores'>>

/**
 * Look at a project and report what it is built with. Reads files only; runs nothing but git.
 * The policy's `detect` leaves technologies out, and its `runtime` replaces the detected runtimes.
 */
export const detect = (root: string, options: DetectOptions = {}): Detection => {
  const manifest = readJson<Manifest>(join(root, 'package.json'))
  const packages = workspacePackages(root, manifest)
  const packageDependencies = Object.fromEntries(
    packages.map(dir => [dir, dependencyNames(readJson<Manifest>(join(root, dir, 'package.json'))).sort()])
  )
  const dependencies = new Set([...dependencyNames(manifest), ...Object.values(packageDependencies).flat()])
  const tool = detectWorkspaceTool(root)
  const tools: Detection['tools'] = {}
  const enabled = options.detect?.enabled !== false
  const excluded: Detectable[] = enabled ? [...(options.detect?.exclude ?? [])] : [...DETECTABLE]
  const keep = (frameworks: Framework[]): Framework[] => frameworks.filter(framework => !excluded.includes(framework))
  const probe: Probe = enabled ? probeFiles(root) : { formats: new Set(), astro: false, markers: [] }
  const skipped = ignoreMatcher(root, {
    defaultIgnores: options.defaultIgnores ?? true,
    gitignore: options.gitignore ?? true,
    ignore: options.ignore ?? []
  })
  // A project the repo ignores is generated, such as the ios and android folders of an Expo prebuild.
  const languages = languageProjects(root, probe.markers).filter(
    project => !excluded.includes(project.language) && (project.dir === '' || !skipped(project.dir))
  )
  // Astro components with no package that declares Astro: then the files are the only sign of it.
  const astroFromFiles = probe.astro && !frameworksIn(dependencies).includes('astro')
  const withFiles = (frameworks: Framework[]): Framework[] => (astroFromFiles ? [...frameworks, 'astro'] : frameworks)

  for (const name of ['biome', 'eslint', 'oxlint', 'prettier', 'cspell', 'jsdoc'] as const) {
    const file = firstExisting(root, TOOL_FILES[name])

    if (file) tools[name] = file
  }

  if (!tools.prettier && manifest?.prettier !== undefined) tools.prettier = 'package.json'

  const frameworks = keep(withFiles(frameworksIn(dependencies)))
  // The policy's runtimes win. With detection off, the code may run anywhere.
  const runtimesFor = (): Runtime[] => {
    if (options.runtime) return [...options.runtime]

    return enabled ? detectRuntimes(root, dependencies, frameworks, manifest !== undefined) : ['node', 'browser']
  }

  return {
    root,
    git: isGitRepo(root),
    packageManager: detectPackageManager(root, manifest),
    workspace: {
      tool,
      packages,
      frameworks: Object.fromEntries(packages.map(dir => [dir, keep(frameworksIn(packageDependencies[dir] ?? []))])),
      dependencies: packageDependencies
    },
    typescript:
      dependencies.has('typescript') ||
      TSCONFIG_FILES.some(name => existsSync(join(root, name))) ||
      packages.some(dir => TSCONFIG_FILES.some(name => existsSync(join(root, dir, name)))),
    dependencies: [...dependencies].sort(),
    frameworks,
    // Astro components found in the files count for the root: Astro's rules then apply repo-wide.
    rootFrameworks: keep(withFiles(frameworksIn(dependencyNames(manifest)))),
    rootDependencies: dependencyNames(manifest).sort(),
    runtimes: runtimesFor(),
    formats: [...probe.formats].sort(),
    languages,
    ignores: languageIgnores(languages),
    excluded,
    tools
  }
}

/** The file formats and tools that call for a pack, and the pack each calls for. */
const FILE_PACKS: readonly [(detection: Detection) => boolean, string][] = [
  [detection => detection.formats.includes('markdown'), 'markdown'],
  [detection => detection.formats.includes('yaml'), 'yaml'],
  [detection => detection.formats.includes('jsonc'), 'jsonc'],
  [detection => detection.formats.includes('toml'), 'toml'],
  [detection => detection.formats.includes('graphql'), 'graphql'],
  [detection => detection.tools.cspell !== undefined, 'cspell'],
  [detection => detection.tools.jsdoc !== undefined || detection.dependencies.includes('jsdoc'), 'jsdoc']
]

/**
 * The packs the repo's files call for: a format a pack lints, or a tool's config file.
 * These are suggestions only. A pack switches on when the policy names it or `pawl add` adds it.
 */
export const filePacks = (detection: Detection): string[] =>
  FILE_PACKS.filter(([found]) => found(detection)).map(([, pack]) => pack)

export const usesReact = (detection: Detection): boolean =>
  detection.frameworks.some(framework => framework === 'react' || framework === 'next' || framework === 'react-native')

/** The technology each framework brings rules for. A Next.js app is also a React app. */
const FRAMEWORK_TECHNOLOGIES: Partial<Record<Framework, Technology[]>> = {
  react: ['react'],
  next: ['react', 'next'],
  'react-native': ['react', 'react-native'],
  qwik: ['qwik'],
  solid: ['solid'],
  vue: ['vue'],
  nuxt: ['vue'],
  svelte: ['svelte'],
  astro: ['astro'],
  tailwind: ['tailwind'],
  'tanstack-query': ['tanstack-query'],
  drizzle: ['drizzle'],
  playwright: ['playwright'],
  preact: [],
  'react-router': ['react'],
  'tanstack-start': []
}

const toTechnologies = (frameworks: readonly Framework[]): Technology[] => {
  const found = new Set(frameworks.flatMap(framework => FRAMEWORK_TECHNOLOGIES[framework] ?? []))

  return GATED_TAGS.filter(technology => found.has(technology))
}

const withTurbo = (found: Technology[], detection: Detection): Technology[] =>
  detection.workspace.tool === 'turbo' && !detection.excluded.includes('turbo') ? [...found, 'turbo'] : found

/**
 * The technologies whose rules apply to the whole repo. In a monorepo that is what the root
 * package.json depends on; each package adds its own through `packageTechnologies`.
 */
export const technologies = (detection: Detection): Technology[] => {
  const isMonorepo = detection.workspace.packages.length > 0

  return withTurbo(toTechnologies(isMonorepo ? detection.rootFrameworks : detection.frameworks), detection)
}

/** Every technology used anywhere in the repo. */
export const allTechnologies = (detection: Detection): Technology[] =>
  withTurbo(toTechnologies(detection.frameworks), detection)

/** For a monorepo: the technologies each package uses beyond the repo-wide ones. */
export const packageTechnologies = (detection: Detection): Record<string, Technology[]> => {
  const shared = technologies(detection)
  const perPackage: Record<string, Technology[]> = {}

  for (const [dir, frameworks] of Object.entries(detection.workspace.frameworks)) {
    const own = toTechnologies(frameworks).filter(technology => !shared.includes(technology))

    if (own.length > 0) perPackage[dir] = own
  }

  return perPackage
}

export const needsEslint = (detection: Detection): boolean =>
  detection.frameworks.some(framework => NEEDS_ESLINT.includes(framework))

/** A one-line description for humans, such as "TypeScript, React, Turborepo with 6 packages, pnpm". */
export const describe = (detection: Detection): string => {
  // A repo with no package.json at all and code in another language has no JavaScript to name.
  const noJavaScript = !detection.typescript && !detection.packageManager && detection.languages.length > 0
  const parts: string[] = noJavaScript ? [] : [detection.typescript ? 'TypeScript' : 'JavaScript']
  const names: Record<Framework, string> = {
    react: 'React',
    next: 'Next.js',
    vue: 'Vue',
    nuxt: 'Nuxt',
    svelte: 'Svelte',
    angular: 'Angular',
    astro: 'Astro',
    solid: 'Solid',
    'react-native': 'React Native',
    qwik: 'Qwik',
    tailwind: 'Tailwind CSS',
    'tanstack-query': 'TanStack Query',
    drizzle: 'Drizzle',
    playwright: 'Playwright',
    hono: 'Hono',
    lit: 'Lit',
    nest: 'NestJS',
    preact: 'Preact',
    'react-router': 'React Router',
    'tanstack-start': 'TanStack Start',
    vite: 'Vite'
  }

  parts.push(...detection.frameworks.map(framework => names[framework]))
  parts.push(...languagesOf(detection.languages).map(language => LANGUAGE_INFO[language].title))

  const count = detection.workspace.packages.length
  const toolName = detection.workspace.tool ? WORKSPACE_TOOL_NAMES[detection.workspace.tool] : undefined

  const packages = `${count} package${count === 1 ? '' : 's'}`

  if (toolName) parts.push(count > 0 ? `${toolName} with ${packages}` : toolName)
  else if (count > 0) parts.push(`workspace with ${packages}`)

  if (detection.packageManager) parts.push(detection.packageManager)

  return parts.join(', ')
}
