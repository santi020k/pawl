import { ESLint, type Linter } from 'eslint'
import { describe, expect, it } from 'vitest'
import { check, eslintPlan, mergeLayers } from '../src/index.ts'
import { type PolicyInput } from '../src/types.ts'
import { pluginRoot } from './fixtures/eslint/plugins.ts'
import { link, project } from './helpers.ts'

const planFor = (root: string, input: PolicyInput) =>
  eslintPlan({
    root,
    policy: mergeLayers([{ source: 'repo', input }]),
    biomeActive: false,
    typescript: false,
    pluginRoots: [pluginRoot]
  })

const ruleIds = (reports: readonly ESLint.LintResult[]): string[] =>
  reports.flatMap(report => report.messages.flatMap(message => (message.ruleId === null ? [] : [message.ruleId])))

describe('the JSON pack', () => {
  // Files whose key order means something to the people and tools that read them, as pawl writes them.
  const files = {
    'package.json': { name: 'formats', version: '1.0.0', type: 'module', scripts: { test: 'vitest', build: 'tsc' } },
    'tsconfig.json': { extends: './base.json', include: ['src'], compilerOptions: { strict: true } },
    '.vscode/tasks.json': {
      version: '2.0.0',
      tasks: [{ label: 'pawl: check', type: 'shell', command: 'pawl check', problemMatcher: [] }]
    }
  }

  it('leaves the order of the keys alone, so a fix does not rewrite package.json or tsconfig.json', async () => {
    const root = project(files)
    const plan = await planFor(root, { packs: ['jsonc'] })
    const runner = new ESLint({
      cwd: root,
      overrideConfigFile: true,
      overrideConfig: plan.config as Linter.Config[],
      fix: true
    })
    const reports = await runner.lintFiles(Object.keys(files))

    expect(reports.map(report => report.messages.filter(message => message.fatal))).toEqual([[], [], []])
    expect(ruleIds(reports)).not.toContain('jsonc/sort-keys')
    expect(reports.map(report => report.output)).toEqual([undefined, undefined, undefined])
  })

  it('sorts the keys where the policy asks for it', async () => {
    const root = project(files)
    const plan = await planFor(root, {
      packs: ['jsonc'],
      overrides: [{ files: ['tsconfig.json'], rules: { 'jsonc/sort-keys': 'warn' } }]
    })
    const runner = new ESLint({ cwd: root, overrideConfigFile: true, overrideConfig: plan.config as Linter.Config[] })

    expect(ruleIds(await runner.lintFiles(['tsconfig.json']))).toContain('jsonc/sort-keys')
    expect(ruleIds(await runner.lintFiles(['package.json']))).not.toContain('jsonc/sort-keys')
  })

  it.each([
    ['biome', ['no-dupe-keys']],
    ['eslint', ['jsonc/no-dupe-keys']]
  ])(
    'reports a duplicate key once where %s is the linter',
    async (engine, rules) => {
      const root = project({
        'package.json': {
          name: 'formats',
          type: 'module',
          devDependencies: { '@biomejs/biome': '*', eslint: '*', 'eslint-plugin-jsonc': '*' }
        },
        // Left on auto, Biome lints and ESLint runs next to it for the pack.
        'pawl.config.json': { ...(engine === 'eslint' ? { engine } : {}), formatter: 'biome', packs: ['jsonc'] },
        'biome.json': {
          extends: ['@santi020k/pawl/biome'],
          ...(engine === 'biome' ? {} : { linter: { enabled: false } })
        },
        'eslint.config.js': `import { eslint } from '@santi020k/pawl'\n\nexport default eslint({ root: import.meta.dirname, pluginRoots: [${JSON.stringify(pluginRoot)}] })\n`,
        'config/settings.jsonc': '{\n  "alpha": 1,\n  "alpha": 2\n}\n',
        'config/data.json5': '{\n  "alpha": 1,\n  "alpha": 2\n}\n'
      })

      link(root, { eslint: true })

      const result = await check({ root })
      const duplicates = (file: string): string[] =>
        result.findings
          .filter(finding => finding.file === file && finding.rule.endsWith('no-dupe-keys'))
          .map(finding => finding.rule)

      expect(result.setup).toEqual([])
      expect(duplicates('config/settings.jsonc')).toEqual(rules)
      // Biome does not read JSON5, so the plugin keeps the check there.
      expect(duplicates('config/data.json5')).toEqual(['jsonc/no-dupe-keys'])
    },
    60_000
  )
})
