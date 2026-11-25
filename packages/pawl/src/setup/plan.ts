import { existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { getGuard } from '../catalog/guards.ts'
import { getPack, PACKS } from '../catalog/packs.ts'
import { findConfigFile } from '../policy/load.ts'
import { type Detection } from '../project/detect.ts'
import { type Policy, type PolicyInput } from '../types.ts'
import { toPosix, writeText } from '../utils/fs.ts'
import { type JsonRecord, mergeDeep, readJsonc, sameJson, writeJson } from '../utils/json.ts'
import { toList } from '../utils/list.ts'
import { policyFile } from './templates.ts'

/** One file a setup command writes. Planning only reads the disk; `apply` writes. */
export interface SetupAction {
  /** Relative to the project root. */
  path: string
  kind: 'create' | 'update'
  summary: string
  apply: () => void
}

/** What a setup command (`init`, `add`, `sync`, `migrate`) would do. Nothing is written until it is applied. */
export interface SetupPlan {
  detection: Detection
  actions: SetupAction[]
  /** Things the user should know or do by hand. */
  notes: string[]
  /** The command that installs what is missing, when something is. */
  install: string | undefined
  /** The packages that command installs. */
  packages: string[]
  /** The policy the plan was made for, with what the plan pins in it. */
  policy: Policy
}

/** Write every file in the plan. */
export const applyPlan = (plan: Pick<SetupPlan, 'actions'>): void => {
  for (const action of plan.actions) action.apply()
}

/** One line per action, for people. */
export const describeActions = (actions: readonly SetupAction[]): string[] =>
  actions.map(action => `${action.kind === 'create' ? 'Write ' : 'Update'} ${action.path}  (${action.summary})`)

/** Refuse names that are neither a pack nor an opt-in guard, which are asked for the same way. */
export const assertPacks = (names: readonly string[], { required = false }: { required?: boolean } = {}): void => {
  const unknown = names.filter(name => !getPack(name) && !getGuard(name)?.optIn)

  if (unknown.length === 0 && !(required && names.length === 0)) return

  const problem =
    unknown.length === 0 ? 'Which pack?' : `Unknown pack${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}.`

  throw new Error(`${problem} Packs: ${PACKS.map(pack => pack.name).join(', ')}.`)
}

/**
 * Pin what a plan chose in a new pawl.config.ts. A policy file the user wrote is never edited:
 * a note says what to add to it instead.
 */
export const planPolicyFile = (root: string, pinned: PolicyInput, notes: string[]): SetupAction | undefined => {
  if (Object.keys(pinned).length === 0) return undefined

  const file = findConfigFile(root)

  if (file) {
    notes.push(
      `Add ${JSON.stringify(pinned)} to ${toPosix(relative(root, file))}. Pawl does not edit a policy file you wrote.`
    )

    return undefined
  }

  return {
    path: 'pawl.config.ts',
    kind: 'create',
    summary: Object.entries(pinned)
      .map(([key, value]) => `${key}: ${toList(value as string | string[]).join(', ')}`)
      .join('; '),
    apply: () => writeText(join(root, 'pawl.config.ts'), policyFile(pinned))
  }
}

/** Merge settings into a JSON file, creating it when it is missing. A file with comments is left alone. */
export const planJsonMerge = (
  root: string,
  file: string,
  patch: JsonRecord,
  summary: string,
  notes: string[]
): SetupAction | undefined => {
  const path = join(root, file)

  if (!existsSync(path)) return { path: file, kind: 'create', summary, apply: () => writeJson(path, patch) }

  const { value, hasComments } = readJsonc<JsonRecord>(path)

  if (!value || hasComments) {
    notes.push(`${file} has comments or could not be read, so pawl left it alone.`)

    return undefined
  }

  const merged = mergeDeep(value, patch)

  return sameJson(merged, value)
    ? undefined
    : { path: file, kind: 'update', summary, apply: () => writeJson(path, merged) }
}

/**
 * What to say about an .eslintrc file. ESLint 9 and later read flat config only, so the file's
 * rules reach pawl through `pawl migrate` or not at all.
 */
export const legacyNote = (file: string, replaced: boolean, migrated: boolean): string => {
  if (migrated)
    return `${file} is a legacy ESLint config. Its rules are in the policy now, so you can remove the file when you are ready.`

  return replaced
    ? `${file} is a legacy ESLint config, which ESLint no longer reads now that eslint.config.js is there. Its rules were not carried over: "pawl migrate" does that, before "pawl init" has run.`
    : `${file} is a legacy ESLint config, which pawl does not run. Run "pawl migrate" in place of "pawl init" to carry its rules into the policy, or remove ESLint and the file when you are ready.`
}
