/** Bringing each engine's config file in line with the policy, for `init` and `sync`. */

import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BIOME_PRESET, type BiomeContext, biomeProjectConfig } from '../engines/biome/config.ts'
import { BIOME_OWNERSHIP_FILE, biomeOwnership, ownsBiomeOverrides } from '../engines/biome/ownership.ts'
import {
  biomeContextFor,
  checkBiomeConfig,
  checkRuleFiles,
  inlineOverridesConflict,
  nestedBiomeConfigs,
  switchedOff,
  syncBiomeGlobals
} from '../engines/biome/state.ts'
import { checkOxlintConfig, mergeOxlintConfig, oxlintConfig, oxlintContextFor } from '../engines/oxlint/config.ts'
import { checkPrettierConfig, prettierConfig } from '../engines/prettier/config.ts'
import { OXLINT_CONFIG_FILE } from '../project/config-files.ts'
import { type Detection } from '../project/detect.ts'
import { type Toolset } from '../project/toolset.ts'
import { type Policy } from '../types.ts'
import { writeText } from '../utils/fs.ts'
import { isRecord, type JsonRecord, mergeDeep, readJsonc, sameJson, writeJson } from '../utils/json.ts'
import { toList } from '../utils/list.ts'
import { type SetupAction } from './plan.ts'

/** Join two `extends` lists, keeping the order and dropping repeats. */
const mergeExtends = (first: unknown, second: unknown): unknown[] => [...new Set([...toList(first), ...toList(second)])]

/** Plan one config write, with an exact backup and ownership recorded only after the write succeeds. */
const biomeWrite = (
  root: string,
  file: string,
  value: JsonRecord,
  previous: string | undefined,
  own: boolean,
  summary: string
): SetupAction[] => {
  const path = join(root, file)
  const backup =
    previous !== undefined && own
      ? `.pawl/backups/biome-${createHash('sha256').update(previous).digest('hex')}.json`
      : undefined
  const metadataPath = join(root, BIOME_OWNERSHIP_FILE)
  const plainPath = (relative: string, directory = false): void => {
    const stat = lstatSync(join(root, relative), { throwIfNoEntry: false })

    if (stat && (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1)))
      throw new Error(`${relative} is not a plain ${directory ? 'directory' : 'file'}. Pawl left it unchanged.`)
  }
  const paths = (): void => {
    plainPath(file)
    if (!own) return

    plainPath('.pawl', true)
    plainPath(BIOME_OWNERSHIP_FILE)
    if (backup) {
      plainPath('.pawl/backups', true)
      plainPath(backup)
      if (existsSync(join(root, backup)) && readFileSync(join(root, backup), 'utf8') !== previous)
        throw new Error(`${backup} differs from the expected backup.`)
    }
  }

  // Validate every destination before returning any action, including the metadata written last.
  paths()
  const metadata = own && existsSync(metadataPath) ? readFileSync(metadataPath, 'utf8') : undefined
  if (metadata !== undefined) {
    const oldConfig = previous === undefined ? undefined : readJsonc<JsonRecord>(path).value

    if (!oldConfig || !ownsBiomeOverrides(root, file, oldConfig))
      throw new Error(`${BIOME_OWNERSHIP_FILE} is not verified ownership metadata. Pawl left it unchanged.`)
  }

  const preflight = (): void => {
    paths()
    if (own && (existsSync(metadataPath) ? readFileSync(metadataPath, 'utf8') : undefined) !== metadata)
      throw new Error(`${BIOME_OWNERSHIP_FILE} changed after planning. Run pawl sync again.`)
  }
  const unchanged = (): void => {
    preflight()
    const current = existsSync(path) ? readFileSync(path, 'utf8') : undefined

    if (current !== previous) throw new Error(`${file} changed after planning. Run pawl sync again.`)
  }
  const actions: SetupAction[] = []

  if (previous !== undefined && backup) {
    const backupPath = join(root, backup)

    actions.push({
      path: backup,
      kind: 'create',
      summary: `recoverable copy of ${file} before updating generated scopes`,
      apply: () => {
        unchanged()
        if (existsSync(backupPath)) {
          if (readFileSync(backupPath, 'utf8') !== previous)
            throw new Error(`${backup} differs from the expected backup.`)
        } else writeText(backupPath, previous)
      }
    })
  }

  actions.push({
    path: file,
    kind: previous === undefined ? 'create' : 'update',
    summary,
    apply: () => {
      unchanged()
      writeJson(path, value)
    }
  })

  if (own) {
    actions.push({
      path: BIOME_OWNERSHIP_FILE,
      kind: existsSync(join(root, BIOME_OWNERSHIP_FILE)) ? 'update' : 'create',
      summary: 'record the exact generated Biome override array',
      apply: () => {
        preflight()
        const current = readJsonc<JsonRecord>(path).value

        if (!current || !sameJson(current.overrides ?? [], value.overrides ?? []))
          throw new Error(`${file} changed before ownership could be recorded. Run pawl sync again.`)

        writeJson(join(root, BIOME_OWNERSHIP_FILE), biomeOwnership(file, value))
      }
    })
  }

  return actions
}

/** Bring biome.json in line with the policy. Used by both init and sync. */
export const planBiomeConfig = (
  root: string,
  policy: Policy,
  context: BiomeContext,
  notes: string[]
): SetupAction[] => {
  const state = checkBiomeConfig(root, policy, context)
  const file = state.file ?? 'biome.json'
  const path = join(root, file)

  if (state.status === 'ok') return []

  if (state.status === 'missing')
    return biomeWrite(root, file, biomeProjectConfig(policy, context), undefined, true, 'the pawl standard for Biome')

  const previous = readFileSync(path, 'utf8')
  const { value, hasComments } = readJsonc<JsonRecord>(path)

  if (!value || hasComments) {
    notes.push(
      `${file} has comments or could not be read, so pawl left it alone. Add "${BIOME_PRESET}" to its "extends" by hand.`
    )

    return []
  }

  const expected = biomeProjectConfig(policy, context, state.preset ?? BIOME_PRESET)
  const owned = ownsBiomeOverrides(root, file, value)

  if (state.status === 'stale') {
    if (inlineOverridesConflict(value, expected) && !owned) {
      notes.push(
        `${file} has inline overrides whose ownership cannot be established. Preserve a backup and reconcile them with the root policy before syncing; pawl left the file unchanged.`
      )

      return []
    }

    const merged = syncBiomeGlobals(
      { ...mergeDeep(value, expected), extends: mergeExtends(expected.extends, value.extends) },
      expected
    )

    if (owned && expected.overrides === undefined) delete merged.overrides

    // What pawl switched off for another tool, Biome runs again: the standard has it on.
    for (const section of switchedOff(value, context)) {
      const { enabled: _enabled, ...rest } = isRecord(merged[section]) ? merged[section] : {}

      if (Object.keys(rest).length > 0) merged[section] = rest
      else delete merged[section]
    }

    return biomeWrite(
      root,
      file,
      merged,
      previous,
      owned || !Array.isArray(value.overrides) || value.overrides.length === 0,
      'bring it in line with the policy'
    )
  }

  notes.push(
    `Your existing ${file} settings still override the standard. Remove the ones you no longer need to adopt it fully.`
  )

  return biomeWrite(
    root,
    file,
    { ...value, extends: mergeExtends(expected.extends, value.extends) },
    previous,
    false,
    'extend the pawl standard, keeping your settings on top'
  )
}

/** Write the files of pawl's own Biome rules that are missing or out of date. */
export const planRuleFiles = (root: string, policy: Policy, context: BiomeContext): SetupAction[] =>
  checkRuleFiles(root, policy, context).flatMap(state =>
    state.status === 'ok'
      ? []
      : [
          {
            path: state.file,
            kind: state.status === 'missing' ? ('create' as const) : ('update' as const),
            summary: "one of pawl's own rules, for Biome",
            apply: () => writeText(join(root, state.file), state.content)
          }
        ]
  )

/** Nested configs change the base of inherited policy globs; leave them intact for explicit review. */
export const planBiomePackages = (root: string, notes: string[], gitignore = true): SetupAction[] => {
  for (const file of nestedBiomeConfigs(root, gitignore)) {
    notes.push(
      `${file} is a nested Biome config. Review its settings, preserve a backup outside Biome's config filenames, and move its rules into the root policy before running check or fix.`
    )
  }

  return []
}

/** Bring the Prettier config in line with the standard's style. Used by `init` and `sync`. */
export const planPrettierConfig = (
  root: string,
  policy: Policy,
  notes: string[],
  update: boolean
): SetupAction | undefined => {
  const state = checkPrettierConfig(root, policy)
  const expected = prettierConfig(policy)

  if (state.status === 'missing') {
    return {
      path: '.prettierrc.json',
      kind: 'create',
      summary: "the standard's style for Prettier",
      apply: () => writeJson(join(root, '.prettierrc.json'), expected)
    }
  }

  if (state.status === 'unmanaged') {
    notes.push(
      `Your Prettier config in ${state.file} is unchanged. Pawl cannot read it, so it does not check it against the standard's style.`
    )

    return undefined
  }

  if (state.status !== 'stale' || !state.file) return undefined

  if (!update) {
    notes.push(`${state.issue?.message ?? ''} Your config is unchanged. Run "pawl sync" to adopt the standard's style.`)

    return undefined
  }

  const path = join(root, state.file)
  const current = readJsonc<JsonRecord>(path).value ?? {}

  return {
    path: state.file,
    kind: 'update',
    summary: "adopt the standard's style",
    apply: () => writeJson(path, { ...current, ...expected })
  }
}

/**
 * Bring .oxlintrc.json in line with the policy. Used by `init` and `sync`. `adding` names what
 * `init` is about to add to devDependencies: the config is written before the install runs.
 */
export const planOxlintConfig = (
  root: string,
  policy: Policy,
  detection: Detection,
  adding: readonly string[] = []
): SetupAction | undefined => {
  const context = oxlintContextFor({ ...detection, dependencies: [...detection.dependencies, ...adding] }, root, adding)
  const state = checkOxlintConfig(root, policy, context)
  const path = join(root, OXLINT_CONFIG_FILE)

  if (state.status === 'ok') return undefined

  const current = state.status === 'stale' ? (readJsonc<JsonRecord>(path).value ?? {}) : {}

  return {
    path: OXLINT_CONFIG_FILE,
    kind: state.status === 'missing' ? 'create' : 'update',
    summary: 'the pawl standard for Oxlint',
    // Keys pawl does not manage, such as "settings", stay as the project wrote them.
    apply: () => writeJson(path, mergeOxlintConfig(current, oxlintConfig(policy, context)))
  }
}

/**
 * Bring every config file of the engines a project runs in line with its policy: biome.json
 * with its packages and rule files, .oxlintrc.json, and the Prettier config. `init` leaves a
 * Prettier config the user wrote as it is; `sync` brings it in line. `adding` names the packages
 * `init` is about to add, for the Oxlint config that depends on them.
 */
export const planEngineConfigs = (
  root: string,
  policy: Policy,
  detection: Detection,
  tools: Pick<Toolset, 'linter' | 'formatter'>,
  notes: string[],
  { updatePrettier, adding = [] }: { updatePrettier: boolean; adding?: readonly string[] }
): SetupAction[] => {
  const actions: SetupAction[] = []

  if (tools.linter === 'biome' || tools.formatter === 'biome') {
    const context = biomeContextFor(root, policy, detection, tools)
    const config = planBiomeConfig(root, policy, context, notes)

    actions.push(...config)

    actions.push(
      ...planBiomePackages(root, notes, policy.gitignore && policy.defaultIgnores && detection.git),
      ...planRuleFiles(root, policy, context)
    )
  }

  const oxlint = tools.linter === 'oxlint' ? planOxlintConfig(root, policy, detection, adding) : undefined
  const prettier = tools.formatter === 'prettier' ? planPrettierConfig(root, policy, notes, updatePrettier) : undefined

  return [...actions, ...(oxlint ? [oxlint] : []), ...(prettier ? [prettier] : [])]
}
