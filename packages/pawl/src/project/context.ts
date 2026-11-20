import { loadPolicy } from '../policy/load.ts'
import { type Policy } from '../types.ts'
import { type Detection, detect } from './detect.ts'
import { type Toolset, toolset } from './toolset.ts'

/** A project as every command sees it: its policy, what it is built with, and which tools run. */
export interface Project {
  root: string
  policy: Policy
  detection: Detection
  tools: Toolset
}

/** Load the policy, detect the project and work out its tools, once. Pass a policy to reuse one already loaded. */
export const loadProject = async (root: string, policy?: Policy): Promise<Project> => {
  const resolved = policy ?? (await loadPolicy(root))

  return { root, policy: resolved, detection: detect(root, resolved), tools: toolset(root, resolved) }
}
