import { join } from 'node:path'
import { PACKS } from '../catalog/packs.ts'
import { BIOME_VERSION } from '../engines/biome/config.ts'
import { TYPE_AWARE_PACKAGE } from '../engines/oxlint/config.ts'
import { OXLINT_VERSION, TSGOLINT_VERSION } from '../engines/oxlint/rules.ts'
import { type Detection, type PackageManager } from '../project/detect.ts'
import { readJson } from '../utils/json.ts'
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
  'typescript-eslint': '^8.0.0',
  prettier: '^3.0.0'
}

export const rangeFor = (name: string): string => {
  const known = TOOL_RANGES[name]

  if (known) return known

  const major = /(\d+)/.exec(PACKS.find(pack => pack.plugin === name)?.range ?? '')?.[1]

  return major ? `^${major}.0.0` : '*'
}

/** The command that adds packages to the project with its own package manager. */
export const installCommand = (detection: Detection, packages: readonly string[] = [PACKAGE_NAME]): string => {
  const manager = detection.packageManager ?? 'npm'
  const workspaceFlag = manager === 'pnpm' && detection.workspace.packages.length > 0 ? ' -w' : ''
  // Biome is pinned: pawl reads a report format Biome may change between releases.
  const specs = packages.map(name => (name === '@biomejs/biome' ? `${name}@${BIOME_VERSION}` : name))

  return `${INSTALL[manager]}${workspaceFlag} ${specs.join(' ')}`
}

/** The packages a project already lists, in any dependency group. */
export const listed = (root: string): Set<string> => {
  const manifest = readJson<Record<string, Record<string, string> | undefined>>(join(root, 'package.json'))

  return new Set(Object.keys({ ...manifest?.dependencies, ...manifest?.devDependencies }))
}
