import { join } from 'node:path'
import { firstExisting, PRETTIER_CONFIG_FILES } from '../../project/config-files.ts'
import { type Policy, type SetupIssue } from '../../types.ts'
import { readJson, readJsonc } from '../../utils/json.ts'

/** The Prettier options that express the standard's style. */
export const prettierConfig = (policy: Policy): Record<string, string | number | boolean> => {
  const { style } = policy

  return {
    printWidth: style.lineWidth,
    useTabs: style.indent === 'tab',
    tabWidth: style.indent === 'tab' ? 2 : style.indent,
    semi: style.semicolons,
    singleQuote: style.quotes === 'single',
    trailingComma: style.trailingCommas,
    arrowParens: style.arrowParens === 'always' ? 'always' : 'avoid'
  }
}

export interface PrettierConfigCheck {
  status: 'ok' | 'missing' | 'stale' | 'unmanaged'
  file: string | undefined
  issue?: SetupIssue
}

/**
 * Compare the project's Prettier config with the standard's style.
 * Only JSON configs can be read; a config written in JavaScript is left to its owner.
 */
export const checkPrettierConfig = (root: string, policy: Policy): PrettierConfigCheck => {
  const file = firstExisting(root, PRETTIER_CONFIG_FILES)

  if (!file) {
    const inManifest = readJson<{ prettier?: unknown }>(join(root, 'package.json'))?.prettier !== undefined

    if (inManifest) return { status: 'unmanaged', file: 'package.json' }

    return {
      status: 'missing',
      file,
      issue: { code: 'prettier-config-missing', message: 'No Prettier config found.', fix: 'Run "pawl sync".' }
    }
  }

  if (file !== '.prettierrc' && file !== '.prettierrc.json') return { status: 'unmanaged', file }

  const { value } = readJsonc<Record<string, unknown>>(join(root, file))

  if (!value) return { status: 'unmanaged', file }

  const drifted = Object.entries(prettierConfig(policy)).filter(([key, expected]) => value[key] !== expected)

  if (drifted.length === 0) return { status: 'ok', file }

  return {
    status: 'stale',
    file,
    issue: {
      code: 'prettier-config-stale',
      message: `${file} differs from the standard's style (${drifted.map(([key]) => key).join(', ')}).`,
      fix: 'Run "pawl sync".'
    }
  }
}
