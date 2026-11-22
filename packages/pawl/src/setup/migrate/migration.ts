/** What a migration is asked to do and what it found, shared by the planner and the report. */

import { type Level, type PolicyInput } from '../../types.ts'
import { type SetupAction } from '../plan.ts'

/** Where the full account of a migration is written. */
export const MIGRATION_REPORT = '.pawl/migration.md'

export interface MigrateOptions {
  root: string
  /** Leave the ESLint config file as it is and only write the policy. */
  keepConfig?: boolean
  /** A policy to build on: a package name or a relative path. Only what differs from it is carried over. */
  extends?: string
}

export interface RuleChange {
  rule: string
  /** The level the pawl standard and its packs would set. */
  standard: Level
  /** The level the old config set, which the policy keeps. */
  kept: Level
}

export interface MigratePlan {
  /** The ESLint config that was read, relative to the root. */
  source: string
  /** The files whose resolved configuration was compared. */
  samples: string[]
  policy: PolicyInput
  actions: SetupAction[]
  notes: string[]
  /** Rules that are on in the old config. */
  total: number
  /** Rules the pawl standard and its packs already set to the same level. */
  same: number
  /** Rules whose level the policy carries over because it differs from the standard. */
  changed: RuleChange[]
  /**
   * Rules the old config had looser than the policy this one extends. Moving onto a policy means
   * taking its levels, so they stay at the policy's level (`standard`) and the old level (`kept`)
   * is not written. A stricter level is still carried over.
   */
  policyKept: RuleChange[]
  /** The package of the policy this one extends, for the install. Not set for a path. */
  policyPackage?: string
  /** Rules that are on in the standard and its packs and were not in the old config. */
  added: string[]
  /** Formatting rules. The formatter does their job. */
  formatting: string[]
  /** Import ordering rules. Import sorting does their job. */
  importSorting: string[]
  packs: string[]
  /** Rules whose options the policy carries, that Biome enforces with its own options when it is the linter. */
  biomeOptions: string[]
  /** Rules the policy names that cannot run, and what each one needs. */
  notEnforced: Array<{ rule: string; needs: string }>
}
