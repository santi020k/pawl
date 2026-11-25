import { PEER_RANGES } from '../../version.ts'
import { type Engine } from '../engine.ts'
import { checkPrettierConfig } from './config.ts'
import { prettierInstalled, prettierVersion, runPrettier } from './run.ts'

/** Prettier formats, when the project chose it. It runs without a config file too. */
export const prettier: Engine = {
  name: 'prettier',
  packageName: 'prettier',
  range: PEER_RANGES.prettier,
  active: tools => tools.formatter === 'prettier',
  installed: prettierInstalled,
  version: prettierVersion,
  missing: {
    code: 'prettier-missing',
    message: 'This project formats with Prettier, but Prettier is not installed.',
    fix: 'Add prettier to devDependencies.'
  },
  inspect: ({ root, policy }) => {
    const config = checkPrettierConfig(root, policy)

    return {
      ...(config.file ? { config: config.file } : {}),
      status: config.status,
      runnable: true,
      issues: config.issue ? [config.issue] : []
    }
  },
  run: runPrettier
}
