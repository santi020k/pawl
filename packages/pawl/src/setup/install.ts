import { closeSync, existsSync, openSync, readSync } from 'node:fs'
import { join } from 'node:path'
import { PACKS } from '../catalog/packs.ts'
import { BIOME_VERSION } from '../engines/biome/config.ts'
import { TYPE_AWARE_PACKAGE } from '../engines/oxlint/config.ts'
import { OXLINT_VERSION, TSGOLINT_VERSION } from '../engines/oxlint/rules.ts'
import { type Detection, type PackageManager } from '../project/detect.ts'
import { readJson } from '../utils/json.ts'
import { installedVersion } from '../utils/semver.ts'
import { PACKAGE_NAME, VERSION } from '../version.ts'

const INSTALL: Record<PackageManager, string> = {
  pnpm: 'pnpm add -D',
  npm: 'npm install -D',
  yarn: 'yarn add -D',
  bun: 'bun add -d'
}

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

/**
 * The commands that install packages as they are given, with the project's own package manager,
 * joined by `&&` when there are two. npm writes `^` before the version it is given, so a version
 * pawl pins, such as Biome's, is installed with `--save-exact` on its own, and stays exact in
 * package.json. pnpm, Yarn and Bun keep an exact version exact as it is.
 */
export const upgradeCommand = (detection: Detection, specs: readonly string[]): string => {
  const manager = detection.packageManager ?? 'npm'
  const command = (list: readonly string[], flags = ''): string =>
    `${INSTALL[manager]}${workspaceRootFlag(detection, manager)}${flags} ${list.join(' ')}`

  if (manager !== 'npm') return command(specs)

  const exact = specs.filter(spec => EXACT_SPEC.test(spec))
  const rest = specs.filter(spec => !EXACT_SPEC.test(spec))

  if (exact.length === 0) return command(rest)

  return [command(exact, ' --save-exact'), ...(rest.length > 0 ? [command(rest)] : [])].join(' && ')
}

/** The command that adds packages to the project with its own package manager. */
export const installCommand = (detection: Detection, packages: readonly string[] = [PACKAGE_NAME]): string =>
  upgradeCommand(
    detection,
    // Biome is pinned: pawl reads a report format Biome may change between releases.
    packages.map(name => (name === '@biomejs/biome' ? `${name}@${BIOME_VERSION}` : name))
  )

/** The packages a project already lists, in any dependency group. */
export const listed = (root: string): Set<string> => {
  const manifest = readJson<Record<string, Record<string, string> | undefined>>(join(root, 'package.json'))

  return new Set(Object.keys({ ...manifest?.dependencies, ...manifest?.devDependencies }))
}
