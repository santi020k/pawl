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
import { rangeFor, upgradeCommand } from './install.ts'

/** One tool to move. */
export interface ToolUpgrade {
  name: string
  /** The version the project has now. */
  installed: string
  /** The range pawl works with. */
  wanted: string
  /** What the install asks for: the exact version pawl pins, or the newest one. */
  spec: string
}

export interface UpgradePlan {
  detection: Detection
  upgrades: ToolUpgrade[]
  /** The command that installs them, or undefined when every tool is in range. */
  install: string | undefined
  notes: string[]
}

const EXACT = /^\d+\.\d+\.\d+$/

/**
 * The version to install for a tool out of range. A pin, such as Biome's, is installed exactly.
 * Every other range pawl declares has no upper bound, so the newest version is in it; a range
 * in the command would also need quoting from the shell, which differs on Windows.
 */
export const upgradeSpec = (name: string, root?: string): string => {
  const range = rangeFor(name, root)

  return EXACT.test(range) ? `${name}@${range}` : `${name}@latest`
}

export const planUpgrade = async (root: string): Promise<UpgradePlan> => {
  const [{ detection, policy }, report] = await Promise.all([loadProject(root), doctor(root)])
  const notes: string[] = []
  const upgrades: ToolUpgrade[] = []

  for (const entry of report.compatibility) {
    if (entry.ok) continue

    if (entry.name === 'node') {
      notes.push(`Node ${entry.installed ?? ''} is not one pawl works with (${entry.wanted}). Upgrade Node yourself.`)

      continue
    }

    // A tool that is not installed is for "pawl add" or "pawl init": upgrade moves what is there.
    if (entry.installed === undefined) continue

    upgrades.push({
      name: entry.name,
      installed: entry.installed,
      wanted: entry.wanted,
      spec: upgradeSpec(entry.name, root)
    })
  }

  // The doctor checks the plugins of the packs that loaded. A plugin too old to load its preset
  // is one an upgrade is for, so every pack the policy names is looked at.
  for (const entry of policy.packs) {
    const pack = getPack(entry.split('/')[0] ?? entry)
    const installed = pack && pack.plugin !== 'eslint' ? installedVersion(root, pack.plugin) : undefined

    if (!pack || installed === undefined || satisfies(installed, pack.range)) continue
    if (upgrades.some(upgrade => upgrade.name === pack.plugin)) continue

    upgrades.push({ name: pack.plugin, installed, wanted: pack.range, spec: upgradeSpec(pack.plugin, root) })
  }

  return {
    detection,
    upgrades,
    install:
      upgrades.length > 0
        ? upgradeCommand(
            detection,
            upgrades.map(upgrade => upgrade.spec)
          )
        : undefined,
    notes
  }
}
