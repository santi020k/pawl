import { type Dirent, existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { GATED_TAGS, type Technology } from '../catalog/rules.ts'
import { type Detectable, type Framework, type Policy, type Runtime } from '../types.ts'
import { toPosix } from '../utils/fs.ts'
import { readJson } from '../utils/json.ts'
import { plural } from '../utils/text.ts'
import {
  BIOME_CONFIG_FILES,
  CSPELL_CONFIG_FILES,
  ESLINT_CONFIG_FILES,
  ESLINT_LEGACY_CONFIG_FILES,
  firstExisting,
  hasAny,
  JSDOC_CONFIG_FILES,
  OXLINT_CONFIG_FILES,
  PRETTIER_CONFIG_FILES,
  TSCONFIG_FILES
} from './config-files.ts'
import { isGitRepo } from './files.ts'
import { expandBraces, makeIgnore, WALK_SKIP } from './ignores.ts'

export type { Framework } from '../types.ts'

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
  }
  /** The frameworks the root package.json depends on. */
  rootFrameworks: Framework[]
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

/** The config files that show a tool is in use. */
const TOOL_FILES = {
  biome: BIOME_CONFIG_FILES,
  eslint: [...ESLINT_CONFIG_FILES, ...ESLINT_LEGACY_CONFIG_FILES],
  oxlint: OXLINT_CONFIG_FILES,
  prettier: PRETTIER_CONFIG_FILES,
  cspell: CSPELL_CONFIG_FILES,
  jsdoc: JSDOC_CONFIG_FILES
} as const

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
}

/**
 * A shallow look at the files: which formats a pack could lint, and Astro components.
 * Folders nothing is checked in are skipped, and so are hidden ones but `.github`.
 */
const probeFiles = (root: string): Probe => {
  const probe: Probe = { formats: new Set(), astro: false }
  let budget = PROBE_LIMIT
  const visit = (dir: string, depth: number): void => {
    let entries: Dirent[]

    try {
      entries = readdirSync(join(root, dir), { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (--budget < 0) return

      if (entry.isDirectory()) {
        const hidden = entry.name.startsWith('.') && entry.name !== '.github'

        if (depth < PROBE_DEPTH && !hidden && !WALK_SKIP.has(entry.name)) visit(join(dir, entry.name), depth + 1)
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

/** Every framework and the Turborepo rules: what `detect.exclude` takes, and what `detect: false` leaves out. */
export const DETECTABLE: readonly Detectable[] = [
  ...new Set(FRAMEWORK_PACKAGES.map(([, framework]) => framework)),
  'turbo'
]

const detectPackageManager = (root: string, manifest: Manifest | undefined): PackageManager | undefined => {
  const declared = manifest?.packageManager?.split('@')[0]

  if (declared === 'pnpm' || declared === 'npm' || declared === 'yarn' || declared === 'bun') return declared

  if (existsSync(join(root, 'pnpm-lock.yaml')) || existsSync(join(root, 'pnpm-workspace.yaml'))) return 'pnpm'

  if (existsSync(join(root, 'bun.lock')) || existsSync(join(root, 'bun.lockb'))) return 'bun'

  if (existsSync(join(root, 'yarn.lock'))) return 'yarn'

  if (existsSync(join(root, 'package-lock.json'))) return 'npm'

  return manifest ? 'npm' : undefined
}

const unquote = (text: string): string => text.trim().replace(/^(['"])(.*)\1$/, '$2')

/**
 * Read the `packages:` list of pnpm-workspace.yaml without a YAML dependency. YAML allows the
 * list with or without an indent, and as a flow list on one line: `packages: [apps/*, packages/*]`.
 */
const pnpmWorkspacePatterns = (root: string): string[] => {
  const file = join(root, 'pnpm-workspace.yaml')

  if (!existsSync(file)) return []

  const patterns: string[] = []
  let inPackages = false
  // A flow list that goes on over more lines, such as `packages: [` and then a name on each line.
  let flow: string | undefined

  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.replace(/(^|\s)#.*$/, '')

    if (line.trim() === '') continue

    if (flow !== undefined) {
      flow += ` ${line.trim()}`

      const closed = /^\[(.*)\]$/.exec(flow)

      if (closed) {
        patterns.push(...(closed[1] ?? '').split(',').map(unquote).filter(Boolean))
        flow = undefined
      }

      continue
    }

    const key = /^packages\s*:\s*(.*)$/.exec(line)

    if (key) {
      const value = (key[1] ?? '').trim()
      const list = /^\[(.*)\]$/.exec(value)

      if (list) patterns.push(...(list[1] ?? '').split(',').map(unquote).filter(Boolean))
      else if (value.startsWith('[')) flow = value

      inPackages = value === ''
    } else if (inPackages) {
      const item = /^\s*-\s+(.+)$/.exec(line)

      // Anything else at the start of a line is the next key.
      if (item?.[1]) patterns.push(unquote(item[1]))
      else if (/^\S/.test(line)) inPackages = false
    }
  }

  return patterns
}

/** How many folders a `**` of a workspace pattern looks through at most, so a huge tree cannot stall a check. */
const WORKSPACE_FOLDERS = 20_000

/** Folders pnpm never looks for packages in. A `**` does not enter a dot folder either. */
const NOT_PACKAGES = new Set(['node_modules', 'bower_components'])

const packageFolders = (root: string, dir: string): string[] => {
  try {
    return readdirSync(join(root, dir), { withFileTypes: true })
      .filter(entry => entry.isDirectory() && !NOT_PACKAGES.has(entry.name) && !entry.name.startsWith('.'))
      .map(entry => entry.name)
  } catch {
    return []
  }
}

/** A folder and every folder below it, as a `**` reads them. */
const foldersBelow = (root: string, dir: string): string[] => {
  const found = [dir]

  for (let index = 0; index < found.length && found.length < WORKSPACE_FOLDERS; index++) {
    const parent = found[index] as string

    found.push(...packageFolders(root, parent).map(name => join(parent, name)))
  }

  return found.slice(0, WORKSPACE_FOLDERS)
}

/** One path segment of a workspace pattern, such as `plugin-*` or `[ab]*`, as a test for a folder name. */
const segmentMatcher = (segment: string): ((name: string) => boolean) => {
  let source = ''

  for (let index = 0; index < segment.length; index++) {
    const char = segment[index] as string
    const close = char === '[' ? segment.indexOf(']', index + 2) : -1

    if (char === '*') source += '.*'
    else if (char === '?') source += '.'
    else if (close === -1) source += char.replace(/[.+^${}()|[\]\\]/, '\\$&')
    else {
      const body = segment.slice(index + 1, close).replace(/^!/, '^')

      source += `[${body.replace(/[\\\]]/g, '\\$&')}]`
      index = close
    }
  }

  try {
    const regexp = new RegExp(`^${source}$`)

    return name => regexp.test(name)
  } catch {
    // A class pnpm's glob cannot read either, such as a range written backwards.
    return () => false
  }
}

/** The package folders a workspace pattern names: `packages/*`, `plugins/plugin-*`, `apps/**` or a plain path. */
const expandPattern = (root: string, pattern: string): string[] => {
  const parts = pattern.split('/').filter(part => part !== '' && part !== '.')
  let dirs = ['']

  for (const part of parts) {
    if (part === '**') dirs = dirs.flatMap(dir => foldersBelow(root, dir))
    else if (/[*?[]/.test(part)) {
      const matches = segmentMatcher(part)

      dirs = dirs.flatMap(dir =>
        packageFolders(root, dir)
          .filter(matches)
          .map(name => join(dir, name))
      )
    } else dirs = dirs.map(dir => join(dir, part))
  }

  // The root is the workspace itself, never one of its packages.
  return dirs.filter(dir => dir !== '' && existsSync(join(root, dir, 'package.json'))).map(toPosix)
}

const workspacePackages = (root: string, manifest: Manifest | undefined): string[] => {
  const fromManifest = Array.isArray(manifest?.workspaces)
    ? manifest.workspaces
    : (manifest?.workspaces?.packages ?? [])
  const patterns = [...pnpmWorkspacePatterns(root), ...fromManifest]
    .filter((pattern): pattern is string => typeof pattern === 'string')
    .flatMap(expandBraces)
  // A pattern with a leading "!" takes packages out again. As in pnpm, it is matched against the
  // package's package.json, so `!**/test/**` takes out the package in `packages/test` too.
  const excluded = makeIgnore(
    patterns
      .filter(pattern => pattern.startsWith('!'))
      .map(
        pattern =>
          `/${pattern
            .slice(1)
            .replace(/^\.?\//, '')
            .replace(/\/$/, '')}/package.json`
      )
  )
  const included = patterns.filter(pattern => !pattern.startsWith('!'))

  return [...new Set(included.flatMap(pattern => expandPattern(root, pattern)))]
    .filter(dir => !excluded(`${dir}/package.json`))
    .sort()
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

/** What a policy says about detection. */
export type DetectOptions = Partial<Pick<Policy, 'detect' | 'runtime'>>

/**
 * Look at a project and report what it is built with. Reads files only; runs nothing but git.
 * The policy's `detect` leaves technologies out, and its `runtime` replaces the detected runtimes.
 */
export const detect = (root: string, options: DetectOptions = {}): Detection => {
  const manifest = readJson<Manifest>(join(root, 'package.json'))
  const packages = workspacePackages(root, manifest)
  const manifests = [manifest, ...packages.map(dir => readJson<Manifest>(join(root, dir, 'package.json')))]
  const dependencies = new Set(manifests.flatMap(dependencyNames))
  const tool = detectWorkspaceTool(root)
  const tools: Detection['tools'] = {}
  const enabled = options.detect?.enabled !== false
  const excluded: Detectable[] = enabled ? [...(options.detect?.exclude ?? [])] : [...DETECTABLE]
  const keep = (frameworks: Framework[]): Framework[] => frameworks.filter(framework => !excluded.includes(framework))
  const probe = enabled ? probeFiles(root) : { formats: new Set<FileFormat>(), astro: false }
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
      frameworks: Object.fromEntries(
        packages.map(dir => [
          dir,
          keep(frameworksIn(dependencyNames(readJson<Manifest>(join(root, dir, 'package.json')))))
        ])
      )
    },
    typescript:
      dependencies.has('typescript') ||
      hasAny(root, TSCONFIG_FILES) ||
      packages.some(dir => hasAny(join(root, dir), TSCONFIG_FILES)),
    dependencies: [...dependencies].sort(),
    frameworks,
    // Astro components found in the files count for the root: Astro's rules then apply repo-wide.
    rootFrameworks: keep(withFiles(frameworksIn(dependencyNames(manifest)))),
    runtimes: runtimesFor(),
    formats: [...probe.formats].sort(),
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
  const parts: string[] = [detection.typescript ? 'TypeScript' : 'JavaScript']
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

  const count = detection.workspace.packages.length
  const toolName = detection.workspace.tool ? WORKSPACE_TOOL_NAMES[detection.workspace.tool] : undefined

  const packages = plural(count, 'package')

  if (toolName) parts.push(count > 0 ? `${toolName} with ${packages}` : toolName)
  else if (count > 0) parts.push(`workspace with ${packages}`)

  if (detection.packageManager) parts.push(detection.packageManager)

  return parts.join(', ')
}
