import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isGitRepo, readJson, toPosix } from './fs-utils.ts'
import { GATED_TAGS, type Technology } from './rules.ts'

export type PackageManager = 'pnpm' | 'npm' | 'yarn' | 'bun'

export type WorkspaceTool = 'turbo' | 'nx'

/** A framework or library pawl recognises from the dependencies. */
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
  ['@playwright/test', 'playwright']
]

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
  ]
} as const

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

  return [...new Set(FRAMEWORK_PACKAGES.filter(([name]) => present.has(name)).map(([, framework]) => framework))]
}

const detectWorkspaceTool = (root: string): WorkspaceTool | undefined => {
  if (existsSync(join(root, 'turbo.json')) || existsSync(join(root, 'turbo.jsonc'))) return 'turbo'

  return existsSync(join(root, 'nx.json')) ? 'nx' : undefined
}

const WORKSPACE_TOOL_NAMES: Record<WorkspaceTool, string> = { turbo: 'Turborepo', nx: 'Nx' }

/** Look at a project and report what it is built with. Reads files only; runs nothing but git. */
export const detect = (root: string): Detection => {
  const manifest = readJson<Manifest>(join(root, 'package.json'))
  const packages = workspacePackages(root, manifest)
  const manifests = [manifest, ...packages.map(dir => readJson<Manifest>(join(root, dir, 'package.json')))]
  const dependencies = new Set(manifests.flatMap(dependencyNames))
  const tool = detectWorkspaceTool(root)
  const tools: Detection['tools'] = {}

  for (const name of ['biome', 'eslint', 'oxlint', 'prettier'] as const) {
    const file = firstExisting(root, TOOL_FILES[name])

    if (file) tools[name] = file
  }

  if (!tools.prettier && manifest?.prettier !== undefined) tools.prettier = 'package.json'

  return {
    root,
    git: isGitRepo(root),
    packageManager: detectPackageManager(root, manifest),
    workspace: {
      tool,
      packages,
      frameworks: Object.fromEntries(
        packages.map(dir => [dir, frameworksIn(dependencyNames(readJson<Manifest>(join(root, dir, 'package.json'))))])
      )
    },
    typescript:
      dependencies.has('typescript') ||
      existsSync(join(root, 'tsconfig.json')) ||
      packages.some(dir => existsSync(join(root, dir, 'tsconfig.json'))),
    dependencies: [...dependencies].sort(),
    frameworks: frameworksIn(dependencies),
    rootFrameworks: frameworksIn(dependencyNames(manifest)),
    tools
  }
}

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
  playwright: ['playwright']
}

const toTechnologies = (frameworks: readonly Framework[]): Technology[] => {
  const found = new Set(frameworks.flatMap(framework => FRAMEWORK_TECHNOLOGIES[framework] ?? []))

  return GATED_TAGS.filter(technology => found.has(technology))
}

const withTurbo = (found: Technology[], detection: Detection): Technology[] =>
  detection.workspace.tool === 'turbo' ? [...found, 'turbo'] : found

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
    playwright: 'Playwright'
  }

  parts.push(...detection.frameworks.map(framework => names[framework]))

  const count = detection.workspace.packages.length
  const toolName = detection.workspace.tool ? WORKSPACE_TOOL_NAMES[detection.workspace.tool] : undefined

  const packages = `${count} package${count === 1 ? '' : 's'}`

  if (toolName) parts.push(count > 0 ? `${toolName} with ${packages}` : toolName)
  else if (count > 0) parts.push(`workspace with ${packages}`)

  if (detection.packageManager) parts.push(detection.packageManager)

  return parts.join(', ')
}
