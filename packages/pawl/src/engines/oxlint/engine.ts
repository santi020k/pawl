import { OXLINT_CONFIG_FILE } from '../../project/config-files.ts'
import { PEER_RANGES } from '../../version.ts'
import { type Engine } from '../engine.ts'
import { checkOxlintConfig, oxlintContextFor } from './config.ts'
import { oxlintInstalled, runOxlint } from './run.ts'

/** Oxlint lints, when the policy names it. */
export const oxlint: Engine = {
  name: 'oxlint',
  packageName: 'oxlint',
  range: PEER_RANGES.oxlint,
  active: tools => tools.linter === 'oxlint',
  installed: oxlintInstalled,
  missing: {
    code: 'oxlint-missing',
    message: 'This project lints with Oxlint, but Oxlint is not installed.',
    fix: 'Add oxlint to devDependencies.'
  },
  inspect: ({ root, policy, detection }) => {
    const config = checkOxlintConfig(root, policy, oxlintContextFor(detection))

    return {
      config: OXLINT_CONFIG_FILE,
      status: config.status,
      runnable: config.status !== 'missing',
      issues: config.issue ? [config.issue] : []
    }
  },
  run: runOxlint
}
