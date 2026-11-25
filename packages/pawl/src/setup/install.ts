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

/** The command that adds packages to the project with its own package manager. */
export const installCommand = (detection: Detection, packages: readonly string[] = [PACKAGE_NAME]): string => {
  const manager = detection.packageManager ?? 'npm'
  const workspaceFlag = manager === 'pnpm' && detection.workspace.packages.length > 0 ? ' -w' : ''
  // Biome is pinned: pawl reads a report format Biome may change between releases.
  const specs = packages.map(name => (name === '@biomejs/biome' ? `${name}@${BIOME_VERSION}` : name))

  return `${INSTALL[manager]}${workspaceFlag} ${specs.join(' ')}`
}

/** The command that installs packages as they are given, with a version each, with the project's own package manager. */
export const upgradeCommand = (detection: Detection, specs: readonly string[]): string => {
  const manager = detection.packageManager ?? 'npm'
  const workspaceFlag = manager === 'pnpm' && detection.workspace.packages.length > 0 ? ' -w' : ''

  return `${INSTALL[manager]}${workspaceFlag} ${specs.join(' ')}`
}

/** The packages a project already lists, in any dependency group. */
export const listed = (root: string): Set<string> => {
  const manifest = readJson<Record<string, Record<string, string> | undefined>>(join(root, 'package.json'))

  return new Set(Object.keys({ ...manifest?.dependencies, ...manifest?.devDependencies }))
}
