/** Bringing each engine's config file in line with the policy, for `init` and `sync`. */

import { join } from 'node:path'
import { BIOME_PRESET, type BiomeContext, biomeProjectConfig } from '../engines/biome/config.ts'
import {
  biomeContextFor,
  checkBiomeConfig,
  checkBiomePackages,
  checkRuleFiles,
  syncBiomeGlobals
} from '../engines/biome/state.ts'
import { checkOxlintConfig, mergeOxlintConfig, oxlintConfig, oxlintContextFor } from '../engines/oxlint/config.ts'
import { checkPrettierConfig, prettierConfig } from '../engines/prettier/config.ts'
import { OXLINT_CONFIG_FILE } from '../project/config-files.ts'
import { type Detection, packageTechnologies } from '../project/detect.ts'
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
export const planRuleFiles = (
  root: string,
  policy: Policy,
  context: BiomeContext,
  detection: Detection
): SetupAction[] =>
  checkRuleFiles(root, policy, context, Object.keys(packageTechnologies(detection))).flatMap(state =>
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

/** In a monorepo, give each package that needs it a biome.json with its own technology's rules. */
export const planBiomePackages = (
  root: string,
  detection: Detection,
  notes: string[],
  preset?: string
): SetupAction[] => {
  const rootFile = detection.tools.biome ?? 'biome.json'
  const actions: SetupAction[] = []

  for (const state of checkBiomePackages(root, packageTechnologies(detection), rootFile, preset)) {
    const path = join(root, state.file)
    const rules = (packageTechnologies(detection)[state.dir] ?? []).join(', ')

    if (state.status === 'ok') continue

    if (state.status === 'missing') {
      actions.push({
        path: state.file,
        kind: 'create',
        summary: `${rules} rules for this package only`,
        apply: () => writeJson(path, state.expected)
      })
    } else if (state.status === 'stale' && state.current) {
      const current = state.current

      actions.push({
        path: state.file,
        kind: 'update',
        summary: `add the ${rules} rules`,
        apply: () => writeJson(path, { ...current, extends: mergeExtends(current.extends, state.expected.extends) })
      })
    } else {
      notes.push(
        `${state.file} has comments or could not be read, so pawl left it alone. It should extend ${JSON.stringify(state.expected.extends)}.`
      )
    }
  }

  return actions
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

/** Bring .oxlintrc.json in line with the policy. Used by `init` and `sync`. */
export const planOxlintConfig = (root: string, policy: Policy, detection: Detection): SetupAction | undefined => {
  const context = oxlintContextFor(detection)
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
 * Prettier config the user wrote as it is; `sync` brings it in line.
 */
export const planEngineConfigs = (
  root: string,
  policy: Policy,
  detection: Detection,
  tools: Pick<Toolset, 'linter' | 'formatter'>,
  notes: string[],
  { updatePrettier }: { updatePrettier: boolean }
): SetupAction[] => {
  const actions: SetupAction[] = []

  if (tools.linter === 'biome' || tools.formatter === 'biome') {
    const context = biomeContextFor(root, policy, detection, tools)
    const config = planBiomeConfig(root, policy, context, notes)

    if (config) actions.push(config)

    const { preset } = checkBiomeConfig(root, policy, context)

    actions.push(
      ...planBiomePackages(root, detection, notes, preset),
      ...planRuleFiles(root, policy, context, detection)
    )
  }

  const oxlint = tools.linter === 'oxlint' ? planOxlintConfig(root, policy, detection) : undefined
  const prettier = tools.formatter === 'prettier' ? planPrettierConfig(root, policy, notes, updatePrettier) : undefined

  return [...actions, ...(oxlint ? [oxlint] : []), ...(prettier ? [prettier] : [])]
}
