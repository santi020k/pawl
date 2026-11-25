/**
 * `pawl upgrade`: bring the tools in line with the versions this pawl works with, then the config
 * files in line with the policy. The doctor already knows each range: Biome pinned exactly, the
 * other engines and every pack plugin by their peer ranges. Upgrade installs the tools that are
 * installed and out of range, and `sync` runs after the install, with the new versions in place.
 */

import { getPack } from '../catalog/packs.ts'
import { loadProject } from '../policy/project.ts'
import { type Detection } from '../project/detect.ts'
import { doctor } from '../report/doctor.ts'
import { installedVersion, satisfies } from '../utils/semver.ts'
import { type Destination, declarations, PLUGIN_PEERS, rangeFor, upgradeCommand } from './install.ts'

/** One tool to move. */
export interface ToolUpgrade {
  name: string
  /** The version the project has now. */
  installed: string
  /** The range pawl works with. */
  wanted: string
  /** What the install asks for: the exact version pawl pins, or the newest of a release line. */
  spec: string
  /** The spec leaves the major version the project has, because no version in it is one pawl works with. */
  major: boolean
  /** The folders it is installed in: each workspace package that declares it, `''` for the root. */
  where: string[]
}

export interface UpgradePlan {
  detection: Detection
  upgrades: ToolUpgrade[]
  /** The command that installs them, or undefined when every tool is in range. */
  install: string | undefined
  notes: string[]
}

const EXACT = /^\d+\.\d+\.\d+$/

/** The release line of a version, as `^` reads it: its major, below 1.0.0 its minor, below 0.1.0 its patch. */
const releaseLine = (version: string): string | undefined => {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version)

  if (!match) return undefined

  const [, major = '', minor = '', patch = ''] = match

  if (major !== '0') return major

  return minor === '0' ? `0.0.${patch}` : `0.${minor}`
}

/**
 * What to install for a tool out of range, and whether it leaves the tool's major version. A pin,
 * such as Biome's, is installed exactly. Every other range pawl declares is a floor, so the newest
 * version of the line the tool is in, `eslint@9`, is in it when the floor is in that line too: the
 * tool stays on its major version. Only a tool older than the floor's line moves, and to the
 * floor's line, the nearest that works. A line needs no quoting in any shell; `^9.35.0` does in cmd.exe.
 */
export const upgradeSpec = (
  name: string,
  installed: string,
  wanted: string,
  root?: string
): { spec: string; major: boolean } => {
  const pinned = rangeFor(name, root)
  const own = releaseLine(installed)

  if (EXACT.test(pinned)) return { spec: `${name}@${pinned}`, major: own !== releaseLine(pinned) }

  const floor = /(\d+\.\d+\.\d+)/.exec(wanted)?.[1]
  const target = floor === undefined ? undefined : releaseLine(floor)

  if (own === undefined || floor === undefined || target === undefined) return { spec: `${name}@latest`, major: true }

  // A prerelease above the floor is out of range too, and the newest release of its own line is in it.
  const stays = own === target || satisfies(installed.replace(/[-+].*$/, ''), `>=${floor}`)

  return stays ? { spec: `${name}@${own}`, major: false } : { spec: `${name}@${target}`, major: true }
}

/** Where a tool goes: each place that declares it, else the root, as when another package brought it. */
const destinationsOf = (detection: Detection, name: string): Destination[] => {
  const declared = declarations(detection, name)

  return declared.length > 0 ? declared : [{ dir: '', group: 'devDependencies' }]
}

/** The install for every upgrade, into the root or the workspace packages that declare each tool. */
const installFor = (detection: Detection, upgrades: readonly ToolUpgrade[], notes: string[]): string | undefined => {
  const manager = detection.packageManager ?? 'npm'
  const groups = new Map<string, { destination: Destination; upgrades: ToolUpgrade[] }>()

  for (const upgrade of upgrades) {
    for (const destination of destinationsOf(detection, upgrade.name)) {
      const key = `${destination.dir}\0${destination.group}`

      groups.set(key, {
        destination,
        upgrades: [...(groups.get(key)?.upgrades ?? []), upgrade]
      })
    }
  }

  const first: string[] = []
  const rest: string[] = []

  for (const { destination, upgrades: moving } of groups.values()) {
    const specs = moving.map(upgrade => upgrade.spec)
    const peers = moving.flatMap(upgrade => PLUGIN_PEERS[upgrade.name] ?? [])
    // npm cannot move a plugin and a peer it used to bring itself at once, so the peer goes first.
    const separate = manager === 'npm' && peers.length > 0
    const main = upgradeCommand(detection, separate ? specs : [...peers, ...specs], destination)
    const before = separate ? upgradeCommand(detection, peers, destination) : undefined

    if (main === undefined) {
      const tools = moving.map(upgrade => `${upgrade.name} ${upgrade.installed}`).join(', ')

      notes.push(
        `${destination.dir} declares ${tools} and has no package name, so pawl cannot install into it. Install ${[...peers, ...specs].join(' ')} in ${destination.dir} yourself.`
      )

      continue
    }

    if (before !== undefined) first.push(before)

    rest.push(main)
  }

  return first.length + rest.length > 0 ? [...first, ...rest].join(' && ') : undefined
}

export const planUpgrade = async (root: string): Promise<UpgradePlan> => {
  const [{ detection, policy }, report] = await Promise.all([loadProject(root), doctor(root)])
  const notes: string[] = []
  const upgrades: ToolUpgrade[] = []
  const add = (name: string, installed: string, wanted: string): void => {
    upgrades.push({
      name,
      installed,
      wanted,
      ...upgradeSpec(name, installed, wanted, root),
      where: destinationsOf(detection, name).map(destination => destination.dir)
    })
  }

  for (const entry of report.compatibility) {
    if (entry.ok) continue

    if (entry.name === 'node') {
      notes.push(`Node ${entry.installed ?? ''} is not one pawl works with (${entry.wanted}). Upgrade Node yourself.`)

      continue
    }

    // A tool that is not installed is for "pawl add" or "pawl init": upgrade moves what is there.
    if (entry.installed === undefined) continue

    add(entry.name, entry.installed, entry.wanted)
  }

  // The doctor checks the plugins of the packs that loaded. A plugin too old to load its preset
  // is one an upgrade is for, so every pack the policy names is looked at.
  for (const entry of policy.packs) {
    const pack = getPack(entry.split('/')[0] ?? entry)
    const installed = pack && pack.plugin !== 'eslint' ? installedVersion(root, pack.plugin) : undefined

    if (!pack || installed === undefined || satisfies(installed, pack.range)) continue
    if (upgrades.some(upgrade => upgrade.name === pack.plugin)) continue

    add(pack.plugin, installed, pack.range)
  }

  for (const upgrade of upgrades.filter(item => item.major)) {
    const own = releaseLine(upgrade.installed)
    const target = upgrade.spec.slice(upgrade.name.length + 1)

    notes.push(
      `No ${upgrade.name} ${own ?? upgrade.installed}.x is in ${upgrade.wanted}, so it moves to ${target}, a new major version. Read its release notes before you commit the upgrade.`
    )
  }

  return { detection, upgrades, install: installFor(detection, upgrades, notes), notes }
}
