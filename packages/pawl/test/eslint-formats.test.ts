import { ESLint, type Linter } from 'eslint'
import { describe, expect, it } from 'vitest'
import { eslintPlan, mergeLayers } from '../src/index.ts'
import { type PolicyInput } from '../src/types.ts'
import { pluginRoot } from './fixtures/eslint/plugins.ts'
import { project } from './helpers.ts'

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
})
