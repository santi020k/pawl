import { loadProject } from '../policy/project.ts'
import { type Toolset } from '../project/toolset.ts'
import { planEngineConfigs } from './engine-configs.ts'
import { type SetupPlan } from './plan.ts'

export interface SyncPlan extends SetupPlan {
  /** The tools the config files were planned for. */
  tools: Toolset
}

/**
 * Work out what `pawl sync` rewrites: the engine config files that are missing or out of date
 * with the policy. ESLint reads the policy each time it starts, so it has no file to sync.
 */
export const planSync = async (root: string): Promise<SyncPlan> => {
  const { policy, detection, tools } = await loadProject(root)
  const notes: string[] = []
  const actions = planEngineConfigs(root, policy, detection, tools, notes, { updatePrettier: true })

  return { detection, actions, notes, install: undefined, packages: [], policy, tools }
}
