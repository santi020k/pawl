import { OXLINT_CONFIG_FILE } from '../../project/config-files.ts'
import { PEER_RANGES } from '../../version.ts'
import { type Engine } from '../engine.ts'
import { checkOxlintConfig, oxlintContextFor, TYPE_AWARE_PACKAGE, tsgolintInstalled } from './config.ts'
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
    const context = oxlintContextFor(detection, root)
    const config = checkOxlintConfig(root, policy, context)
    // The config asks Oxlint for type information, which it cannot get without the package.
    const tsgolintMissing = context.typeAware === true && !tsgolintInstalled(root)
    const issues = config.issue ? [config.issue] : []

    if (tsgolintMissing) {
      issues.push({
        code: 'tsgolint-missing',
        message: `This project depends on ${TYPE_AWARE_PACKAGE}, but it is not installed, so Oxlint cannot run the rules that need type information.`,
        fix: 'Install the dependencies.'
      })
    }

    return {
      config: OXLINT_CONFIG_FILE,
      status: config.status,
      runnable: !tsgolintMissing && config.status !== 'missing',
      issues
    }
  },
  run: runOxlint
}
