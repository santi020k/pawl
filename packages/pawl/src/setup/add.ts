import { join } from 'node:path'
import { getGuard } from '../catalog/guards.ts'
import { getPack, onlyWhenNamed } from '../catalog/packs.ts'
import { loadProject } from '../policy/project.ts'
import { ESLINT_CONFIG_FILES, hasAny } from '../project/config-files.ts'
import { type Policy } from '../types.ts'
import { writeText } from '../utils/fs.ts'
import { PACKAGE_NAME } from '../version.ts'
import { installCommand, listed } from './install.ts'
import { planScripts } from './integrations.ts'
import { assertPacks, legacyNote, planPolicyFile, type SetupAction, type SetupPlan } from './plan.ts'
import { ESLINT_CONFIG } from './templates.ts'

/**
 * Work out what switching packs on takes: the ESLint plugins to install, an ESLint config if
 * the project has none, and the policy entry for packs that are opt-in only.
 */
export const planAdd = async (root: string, names: readonly string[], install = true): Promise<SetupPlan> => {
  assertPacks(names, { required: true })

  const { policy: loaded, detection } = await loadProject(root)
  const actions: SetupAction[] = []
  const notes: string[] = []
  // A guard asked for by name needs no plugin and no ESLint: the linter the project has runs it.
  const needsEslint = names.some(name => getPack(name) !== undefined)

  if (names.some(name => getGuard(name)?.optIn)) notes.push('Run "pawl sync" to switch the new guard on in the linter.')

  if (loaded.engine === 'biome' && needsEslint) {
    notes.push(
      'This repo is set to Biome only, so ESLint does not run and packs have no effect. Remove "engine" from the policy first.'
    )
  }

  if (!needsEslint) {
    // Nothing to set up.
  } else if (hasAny(root, ESLINT_CONFIG_FILES)) {
    notes.push(
      `Packs apply through eslint() from ${PACKAGE_NAME}. Make sure your ${detection.tools.eslint} exports it or spreads it.`
    )
  } else {
    actions.push({
      path: 'eslint.config.js',
      kind: 'create',
      summary: 'ESLint for the packs',
      apply: () => writeText(join(root, 'eslint.config.js'), ESLINT_CONFIG)
    })

    if (detection.tools.eslint) notes.push(legacyNote(detection.tools.eslint, true, false))
  }

  const named = names.filter(name => onlyWhenNamed(name) && !loaded.packs.includes(name))
  const policy: Policy = { ...loaded, packs: [...new Set([...loaded.packs, ...named])] }
  const policyAction = named.length > 0 ? planPolicyFile(root, { packs: policy.packs }, notes) : undefined

  if (policyAction) actions.push(policyAction)

  const present = listed(root)
  const packages = [
    ...new Set([...(needsEslint ? ['eslint'] : []), ...names.flatMap(name => getPack(name)?.plugin ?? [])])
  ].filter(name => !present.has(name))
  const manifest = install ? undefined : planScripts(root, notes, packages)

  if (manifest) actions.push(manifest)

  return {
    detection,
    actions,
    notes,
    install: install && packages.length > 0 ? installCommand(detection, packages) : undefined,
    packages,
    policy
  }
}
