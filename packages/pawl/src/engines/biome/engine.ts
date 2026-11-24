import { PACKAGE_NAME } from '../../version.ts'
import { type Engine } from '../engine.ts'
import { BIOME_PRESET, BIOME_VERSION } from './config.ts'
import { biomeInstalled, runBiome } from './run.ts'
import {
  biomeContextFor,
  checkBiomeConfig,
  checkRuleFiles,
  extendsPackage,
  nestedBiomeConfigs,
  presetInstalled
} from './state.ts'

const stale = (what: string, missing: boolean): string => `${what} is ${missing ? 'missing' : 'out of date'}`

/** Biome lints, formats, or both. */
export const biome: Engine = {
  name: 'biome',
  packageName: '@biomejs/biome',
  range: BIOME_VERSION,
  active: tools => tools.biome,
  installed: biomeInstalled,
  missing: {
    code: 'biome-missing',
    message: 'This project uses Biome, but Biome is not installed.',
    fix: `Add @biomejs/biome@${BIOME_VERSION} to devDependencies.`
  },
  inspect: ({ root, policy, detection, tools }) => {
    const context = biomeContextFor(root, policy, detection, tools)
    const config = checkBiomeConfig(root, policy, context)
    const nested = nestedBiomeConfigs(root, policy.gitignore && policy.defaultIgnores && detection.git)
    const issues = config.issue ? [config.issue] : []

    for (const file of nested) {
      issues.push({
        code: 'biome-config-nested',
        message: `${file} is a nested Biome config that can change root policy scopes.`,
        fix: 'Review its settings, preserve a backup outside Biome config filenames, and move its rules into the root policy. Run "pawl sync" after the explicit migration.'
      })
    }

    for (const state of checkRuleFiles(root, policy, context)) {
      if (state.status === 'ok') continue

      issues.push({
        code: 'biome-config-stale',
        message: `${stale(`${state.file}, one of pawl's own rules for Biome,`, state.status === 'missing')}.`,
        fix: 'Run "pawl sync".'
      })
    }

    // Biome loads the standard from the package biome.json names, and fails in its own words without it.
    const loadable = !extendsPackage(config.preset) || presetInstalled(root)

    if (!loadable) {
      issues.push({
        code: 'pawl-missing',
        message: `${config.file} extends ${BIOME_PRESET}, but ${PACKAGE_NAME} is not installed in this project, so Biome cannot load the standard.`,
        fix: `Add ${PACKAGE_NAME} to devDependencies and install.`
      })
    }

    return {
      ...(config.file ? { config: config.file } : {}),
      status: config.status,
      runnable:
        loadable &&
        config.status !== 'missing' &&
        config.issue?.code !== 'biome-overrides-conflict' &&
        nested.length === 0,
      issues
    }
  },
  run: runBiome
}
