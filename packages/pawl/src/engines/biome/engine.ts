import { packageTechnologies } from '../../project/detect.ts'
import { type Engine } from '../engine.ts'
import { BIOME_VERSION } from './config.ts'
import { biomeInstalled, runBiome } from './run.ts'
import { biomeContextFor, checkBiomeConfig, checkBiomePackages, checkRuleFiles } from './state.ts'

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
    const perPackage = packageTechnologies(detection)
    const issues = config.issue ? [config.issue] : []

    for (const state of checkBiomePackages(root, perPackage, config.file, config.preset)) {
      if (state.status === 'ok') continue

      issues.push({
        code: 'biome-config-stale',
        message: `${stale(state.file, state.status === 'missing')}, so the rules for what that package uses are not applied there.`,
        fix: 'Run "pawl sync".'
      })
    }

    for (const state of checkRuleFiles(root, policy, context, Object.keys(perPackage))) {
      if (state.status === 'ok') continue

      issues.push({
        code: 'biome-config-stale',
        message: `${stale(`${state.file}, one of pawl's own rules for Biome,`, state.status === 'missing')}.`,
        fix: 'Run "pawl sync".'
      })
    }

    return {
      ...(config.file ? { config: config.file } : {}),
      status: config.status,
      runnable: config.status !== 'missing',
      issues
    }
  },
  run: runBiome
}
