import { ESLint, type Linter } from 'eslint'
import { describe, expect, it } from 'vitest'
import { eslintPlan, mergeLayers } from '../src/index.ts'
import { pluginRoot } from './fixtures/eslint/plugins.ts'
import { project } from './helpers.ts'

const POLICY = "import { definePolicy } from '@santi020k/pawl'\n\nexport default definePolicy({ engine: 'eslint' })\n"

describe('the config files of pawl and its linters', () => {
  it.each([
    ['outside the tsconfig, as in a Vite or Svelte project', ['src']],
    ['inside the tsconfig', ['src', '*.ts']]
  ])(
    'parse %s, without type information',
    async (_, include) => {
      const configs = ['pawl.config.ts', 'eslint.config.ts', 'packages/web/pawl.config.mts']
      const root = project({
        'package.json': { name: 'tool-configs', type: 'module' },
        'tsconfig.json': { compilerOptions: { strict: true, noEmit: true }, include },
        'src/index.ts': 'export const later = Promise.resolve(1)\nPromise.resolve(2)\n',
        ...Object.fromEntries(configs.map(file => [file, `${POLICY}debugger\n`]))
      })
      const plan = await eslintPlan({
        root,
        policy: mergeLayers([
          { source: 'repo', input: { rules: { '@typescript-eslint/no-floating-promises': 'error' } } }
        ]),
        biomeActive: false,
        typescript: true,
        pluginRoots: [pluginRoot]
      })
      const runner = new ESLint({ cwd: root, overrideConfigFile: true, overrideConfig: plan.config as Linter.Config[] })
      const reports = await runner.lintFiles([...configs, 'src/index.ts'])
      const messages = (file: string): Linter.LintMessage[] =>
        reports.find(report => report.filePath === `${root}/${file}`)?.messages ?? []

      for (const file of configs) {
        expect(
          messages(file).filter(message => message.fatal),
          file
        ).toEqual([])
        expect(
          messages(file).map(message => message.ruleId),
          file
        ).toContain('no-debugger')
      }

      // The code of the project keeps the rules that need type information.
      expect(messages('src/index.ts').map(message => message.ruleId)).toContain(
        '@typescript-eslint/no-floating-promises'
      )
    },
    60_000
  )
})
