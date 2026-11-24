/** Bringing each engine's config file in line with the policy, for `init` and `sync`. */

import { join } from 'node:path'
import { BIOME_PRESET, type BiomeContext, biomeProjectConfig } from '../engines/biome/config.ts'
import {
  biomeContextFor,
  checkBiomeConfig,
  checkRuleFiles,
  inlineOverridesConflict,
  nestedBiomeConfigs,
  syncBiomeGlobals
} from '../engines/biome/state.ts'
import { checkOxlintConfig, mergeOxlintConfig, oxlintConfig, oxlintContextFor } from '../engines/oxlint/config.ts'
import { checkPrettierConfig, prettierConfig } from '../engines/prettier/config.ts'
import { OXLINT_CONFIG_FILE } from '../project/config-files.ts'
import { type Detection } from '../project/detect.ts'
import { type Toolset } from '../project/toolset.ts'
import { type Policy } from '../types.ts'
import { writeText } from '../utils/fs.ts'
import { type JsonRecord, mergeDeep, readJsonc, writeJson } from '../utils/json.ts'
import { toList } from '../utils/list.ts'
import { type SetupAction } from './plan.ts'

/** Join two `extends` lists, keeping the order and dropping repeats. */
const mergeExtends = (first: unknown, second: unknown): unknown[] => [...new Set([...toList(first), ...toList(second)])]

/** Bring biome.json in line with the policy. Used by both `init` and `sync`. */
export const planBiomeConfig = (
  root: string,
  policy: Policy,
  context: BiomeContext,
  notes: string[]
): SetupAction | undefined => {
  const state = checkBiomeConfig(root, policy, context)
  const file = state.file ?? 'biome.json'
  const path = join(root, file)

  if (state.status === 'ok') return undefined

  if (state.status === 'missing') {
    return {
      path: file,
      kind: 'create',
      summary: 'the pawl standard for Biome',
      apply: () => writeJson(path, biomeProjectConfig(policy, context))
    }
  }

  const { value, hasComments } = readJsonc<JsonRecord>(path)

  if (!value || hasComments) {
    notes.push(
      `${file} has comments or could not be read, so pawl left it alone. Add "${BIOME_PRESET}" to its "extends" by hand.`
    )

    return undefined
  }

  const expected = biomeProjectConfig(policy, context, state.preset ?? BIOME_PRESET)

  if (state.status === 'stale') {
    // Inline override arrays have no ownership marker; replacing or reordering them can lose custom behavior.
    if (inlineOverridesConflict(value, expected)) {
      notes.push(
        `${file} has inline overrides whose ownership cannot be established. Preserve a backup and reconcile them with the root policy before syncing; pawl left the file unchanged.`
      )

      return undefined
    }

    return {
      path: file,
      kind: 'update',
      summary: 'bring it in line with the policy',
      apply: () =>
        writeJson(
          path,
          syncBiomeGlobals(
            { ...mergeDeep(value, expected), extends: mergeExtends(expected.extends, value.extends) },
            expected
          )
        )
    }
  }

  notes.push(
    `Your existing ${file} settings still override the standard. Remove the ones you no longer need to adopt it fully.`
  )

  return {
    path: file,
    kind: 'update',
    summary: 'extend the pawl standard, keeping your settings on top',
    apply: () => writeJson(path, { ...value, extends: mergeExtends(expected.extends, value.extends) })
  }
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

    if (config) actions.push(config)

    actions.push(
      ...planBiomePackages(root, notes, policy.gitignore && policy.defaultIgnores && detection.git),
      ...planRuleFiles(root, policy, context)
    )
  }

  const oxlint = tools.linter === 'oxlint' ? planOxlintConfig(root, policy, detection, adding) : undefined
  const prettier = tools.formatter === 'prettier' ? planPrettierConfig(root, policy, notes, updatePrettier) : undefined

  return [...actions, ...(oxlint ? [oxlint] : []), ...(prettier ? [prettier] : [])]
}
