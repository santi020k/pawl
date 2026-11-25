import { closeSync, existsSync, openSync, readSync } from 'node:fs'
import { join } from 'node:path'
import { PACKS } from '../catalog/packs.ts'
import { BIOME_VERSION } from '../engines/biome/config.ts'
import { eslintPlanFor } from '../engines/eslint/plan.ts'
import { TYPE_AWARE_PACKAGE } from '../engines/oxlint/config.ts'
import { OXLINT_VERSION, TSGOLINT_VERSION } from '../engines/oxlint/rules.ts'
import { type Detection, type PackageManager } from '../project/detect.ts'
import { type Policy } from '../types.ts'
import { readJson } from '../utils/json.ts'
import { installedVersion } from '../utils/semver.ts'
import { PACKAGE_NAME, VERSION } from '../version.ts'

const INSTALL: Record<PackageManager, string> = {
  pnpm: 'pnpm add',
  npm: 'npm install',
  yarn: 'yarn add',
  bun: 'bun add'
}

/** The flag that saves to devDependencies. Without it, every one of them saves to dependencies. */
const DEV_FLAG: Record<PackageManager, string> = { pnpm: ' -D', npm: ' -D', yarn: ' -D', bun: ' -d' }

/** Version ranges pawl writes into package.json when it does not run the package manager itself. */
const TOOL_RANGES: Record<string, string> = {
  [PACKAGE_NAME]: `^${VERSION}`,
  '@biomejs/biome': BIOME_VERSION,
  eslint: '^10.0.0',
  oxlint: OXLINT_VERSION,
  [TYPE_AWARE_PACKAGE]: TSGOLINT_VERSION,
  '@eslint/js': '^10.0.0',
  // Older versions crash in no-unused-expressions under the ESLint pawl needs.
  'typescript-eslint': '^8.15.0',
  prettier: '^3.0.0'
}

/** The range to write for a package: the one pawl works with, else the version the project has installed. */
export const rangeFor = (name: string, root?: string): string => {
  const known = TOOL_RANGES[name]

  if (known) return known

  // A pack's plugin from its floor, the oldest version pawl works with: `^0.14.1` and not
  // `^0.0.0`, which a 0.x plugin's major alone would give, and which no version satisfies.
  const floor = /(\d+\.\d+\.\d+)/.exec(PACKS.find(pack => pack.plugin === name)?.range ?? '')?.[1]

  if (floor) return `^${floor}`

  // Any other package, such as a company policy, is one the project already loads.
  const installed = root === undefined ? undefined : installedVersion(root, name)

  return installed ? `^${installed}` : '*'
}

/** The first bytes of a file, or an empty string when there is none. A lockfile can be megabytes. */
const head = (path: string, bytes = 512): string => {
  let fd: number | undefined

  try {
    fd = openSync(path, 'r')

    const buffer = Buffer.alloc(bytes)

    return buffer.subarray(0, readSync(fd, buffer, 0, bytes, 0)).toString('utf8')
  } catch {
    return ''
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

/**
 * Yarn 1, by the version package.json declares, else by its lockfile: Yarn 2 and later write a
 * `.yarnrc.yml` and a lockfile with `__metadata`. Without either, the `yarn` people install is Yarn 1.
 */
const yarnClassic = (root: string): boolean => {
  const declared = readJson<{ packageManager?: unknown }>(join(root, 'package.json'))?.packageManager
  const major = typeof declared === 'string' ? /^yarn@(\d+)\./.exec(declared)?.[1] : undefined

  if (major !== undefined) return major === '1'

  if (existsSync(join(root, '.yarnrc.yml'))) return false

  return !head(join(root, 'yarn.lock')).includes('__metadata:')
}

/**
 * The flag that adds a package to the root of a workspace, for the package managers that refuse to
 * without one: pnpm, and Yarn 1. Yarn 2 and later, npm and Bun add to the root as they are, and
 * Yarn 2 and later refuse `-W`.
 */
const workspaceRootFlag = (detection: Detection, manager: PackageManager): string => {
  if (detection.workspace.packages.length === 0) return ''

  if (manager === 'pnpm') return ' -w'

  return manager === 'yarn' && yarnClassic(detection.root) ? ' -W' : ''
}

const EXACT_SPEC = /^@?[^@]+@\d+\.\d+\.\d+$/

/** Where packages are installed: the root, `''`, or a workspace package's folder, and the group they are saved in. */
export interface Destination {
  dir: string
  group: 'dependencies' | 'devDependencies'
}

const ROOT: Destination = { dir: '', group: 'devDependencies' }

const rootStart = (detection: Detection, manager: PackageManager, dev: string): string =>
  `${INSTALL[manager]}${dev}${workspaceRootFlag(detection, manager)}`

/**
 * The start of the command that adds packages to one destination, or undefined when it cannot be
 * named in a command: a workspace package without a name, or with a space in its folder for Bun.
 */
const adder = (detection: Detection, manager: PackageManager, { dir, group }: Destination): string | undefined => {
  const dev = group === 'devDependencies' ? DEV_FLAG[manager] : ''

  if (dir === '') return rootStart(detection, manager, dev)

  const name = readJson<{ name?: unknown }>(join(detection.root, dir, 'package.json'))?.name
  const named = typeof name === 'string' && /^\S+$/.test(name) ? name : undefined

  switch (manager) {
    case 'npm':
      return named && `npm install${dev} -w ${named}`
    case 'pnpm':
      return named && `pnpm add${dev} --filter ${named}`
    case 'yarn':
      return named && `yarn workspace ${named} add${dev}`
    default:
      return /\s/.test(dir) ? undefined : `bun add${dev} --cwd ${dir}`
  }
}

/**
 * The command that installs packages as they are given, from its start, joined by `&&` when there
 * are two. npm writes `^` before the version it is given, so a version pawl pins, such as Biome's,
 * is installed with `--save-exact` on its own, and stays exact in package.json. pnpm, Yarn and Bun
 * keep an exact version exact as it is.
 */
const commandFrom = (manager: PackageManager, start: string, specs: readonly string[]): string => {
  const command = (list: readonly string[], flags = ''): string => `${start}${flags} ${list.join(' ')}`

  if (manager !== 'npm') return command(specs)

  const exact = specs.filter(spec => EXACT_SPEC.test(spec))
  const rest = specs.filter(spec => !EXACT_SPEC.test(spec))

  if (exact.length === 0) return command(rest)

  return [command(exact, ' --save-exact'), ...(rest.length > 0 ? [command(rest)] : [])].join(' && ')
}

/**
 * The command that installs packages as they are given into one destination, the root's
 * devDependencies unless it is named, with the project's own package manager. Undefined when the
 * destination cannot be named in a command.
 */
export const upgradeCommand = (
  detection: Detection,
  specs: readonly string[],
  destination: Destination = ROOT
): string | undefined => {
  const manager = detection.packageManager ?? 'npm'
  const start = adder(detection, manager, destination)

  return start === undefined ? undefined : commandFrom(manager, start, specs)
}

/**
 * The command that adds packages to the root of the project with its own package manager, and
 * then the plugins in `after`. npm refuses a whole install when the peer ranges of one package
 * leave out what is there, as eslint-plugin-import's leave out ESLint 10, so under npm those go in
 * a command of their own after the rest: pawl and the tools are installed even when one fails.
 */
export const installCommand = (
  detection: Detection,
  packages: readonly string[] = [PACKAGE_NAME],
  after: readonly string[] = []
): string => {
  const manager = detection.packageManager ?? 'npm'
  const start = rootStart(detection, manager, DEV_FLAG[manager])
  // Biome is pinned: pawl reads a report format Biome may change between releases.
  const specs = packages.map(name => (name === '@biomejs/biome' ? `${name}@${BIOME_VERSION}` : name))

  if (manager !== 'npm' || after.length === 0 || specs.length === 0)
    return commandFrom(manager, start, [...specs, ...after])

  return `${commandFrom(manager, start, specs)} && ${commandFrom(manager, start, after)}`
}

/**
 * Where a package is declared: the root and each workspace package that lists it in its
 * dependencies or devDependencies, with that group. Empty when none of them does.
 */
export const declarations = (detection: Detection, name: string): Destination[] =>
  ['', ...detection.workspace.packages].flatMap((dir): Destination[] => {
    const manifest = readJson<Record<string, Record<string, unknown> | undefined>>(
      join(detection.root, dir, 'package.json')
    )

    if (manifest?.devDependencies?.[name] !== undefined) return [{ dir, group: 'devDependencies' }]

    return manifest?.dependencies?.[name] === undefined ? [] : [{ dir, group: 'dependencies' }]
  })

/**
 * Peers of a pack's plugin that a project would not otherwise have, at the version line the
 * plugin's floor takes. eslint-plugin-vue 9 brought vue-eslint-parser 9 as its own dependency,
 * and 10 takes vue-eslint-parser 10 as a peer: npm cannot swap both in one install and stops with
 * ERESOLVE, so the peer goes in first, in a command of its own. Yarn 1, and npm with
 * `legacy-peer-deps`, install no peers at all, and the plugin cannot load without this one.
 */
export const PLUGIN_PEERS: Readonly<Record<string, readonly string[]>> = {
  'eslint-plugin-vue': ['vue-eslint-parser@10']
}

/** What the ESLint plan says a plugin that is not installed needs: its package name, and nothing more. */
const PACKAGE = /^(?:@[\w.-]+\/)?[\w.-]+$/

/**
 * The plugins ESLint needs for a policy and cannot load, because they are not installed, as
 * `pawl doctor` lists them: the plugin of each pack it switches on, and of each rule of the
 * standard it runs. With ESLint as the linter, those rules take eslint-plugin-unicorn,
 * eslint-plugin-promise and more. A plugin that is installed but fails to load is for the doctor
 * to report, not one to install again.
 */
export const missingPlugins = async (root: string, policy: Policy): Promise<string[]> => {
  const { notEnforced } = await eslintPlanFor(root, policy)

  return [...new Set(notEnforced.map(item => item.needs).filter(needs => PACKAGE.test(needs)))]
}

/** The packages a project already lists, in any dependency group. */
export const listed = (root: string): Set<string> => {
  const manifest = readJson<Record<string, Record<string, string> | undefined>>(join(root, 'package.json'))

  return new Set(Object.keys({ ...manifest?.dependencies, ...manifest?.devDependencies }))
}
