import { PEER_RANGES } from '../../version.ts'
import { type Engine } from '../engine.ts'
import { eslintInstalled, runEslint } from './run.ts'

/**
 * ESLint lints, or runs next to Biome or Oxlint for what only a plugin can check.
 * Its flat config is built from the policy each time it starts, so there is no file to fall out of date.
 */
export const eslint: Engine = {
  name: 'eslint',
  packageName: 'eslint',
  range: PEER_RANGES.eslint,
  active: tools => tools.eslint,
  installed: eslintInstalled,
  missing: {
    code: 'eslint-missing',
    message: 'This project is set up to run ESLint, but ESLint is not installed.',
    fix: 'Add eslint to devDependencies.'
  },
  inspect: () => ({ runnable: true, issues: [] }),
  run: runEslint
}
