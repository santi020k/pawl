import { ESLint } from 'eslint'
import { describe, expect, test } from 'vitest'
import { biomeProjectConfig } from '../src/engines/biome/config.ts'
import { runBiome } from '../src/engines/biome/run.ts'
import { biomeContextFor } from '../src/engines/biome/state.ts'
import { eslintPlanFor } from '../src/engines/eslint/plan.ts'
import { oxlintConfig, oxlintContextFor } from '../src/engines/oxlint/config.ts'
import { runOxlint } from '../src/engines/oxlint/run.ts'
import { mergeLayers } from '../src/policy/merge.ts'
import { detect } from '../src/project/detect.ts'
import { link, project, write } from './helpers.ts'

const cases = [
  { patterns: ['!src/private/**'], allowed: [] },
  { patterns: ['src/[literal]/*.js'], allowed: ['src/[literal]/file.js'] },
  { patterns: ['src/{[literal],other}/*.js'], allowed: ['src/[literal]/file.js', 'src/other/file.js'] },
  {
    patterns: ['src/**', '!src/private/**', 'src/private/kept.js'],
    allowed: ['src/[literal]/file.js', 'src/l/file.js', 'src/other/file.js', 'src/private/kept.js']
  }
]
const paths = [
  'src/[literal]/file.js',
  'src/l/file.js',
  'src/other/file.js',
  'src/private/kept.js',
  'src/private/blocked.js'
]

describe.each(['biome', 'eslint', 'oxlint'] as const)('%s glob boundary', engine => {
  test.each(cases)('preserves literal and ordered policy patterns $patterns', async ({ patterns, allowed }) => {
    const root = project({
      'package.json': { name: 'glob-contract', type: 'module' },
      ...Object.fromEntries(paths.map(path => [path, 'debugger\n']))
    })
    link(root, { eslint: true })
    const policy = mergeLayers([
      {
        source: 'test',
        input: {
          engine,
          rules: { 'no-debugger': 'error' },
          overrides: [{ files: patterns, rules: { 'no-debugger': 'off' } }]
        }
      }
    ])
    let found: string[]
    if (engine === 'eslint') {
      const plan = await eslintPlanFor(root, policy)
      const lint = new ESLint({ cwd: root, overrideConfigFile: true, overrideConfig: plan.config })
      found = []
      for (const path of paths) {
        const results = await lint.lintText('debugger', { filePath: path })
        if (results.some(result => result.messages.some(message => message.ruleId === 'no-debugger'))) found.push(path)
      }
    } else if (engine === 'biome') {
      write(root, {
        'biome.json': biomeProjectConfig(
          policy,
          biomeContextFor(root, policy, detect(root), { linter: 'biome', formatter: 'biome' })
        )
      })
      const report = await runBiome({ root, files: paths })
      found = report.findings.filter(finding => finding.rule === 'no-debugger').map(finding => finding.file)
    } else {
      write(root, { '.oxlintrc.json': oxlintConfig(policy, oxlintContextFor(detect(root))) })
      const report = await runOxlint({ root, files: paths })
      found = report.findings.filter(finding => finding.rule === 'no-debugger').map(finding => finding.file)
    }
    expect(found.sort()).toEqual(paths.filter(path => !allowed.includes(path)).sort())
  })

  test('keeps literal workspace roots separate from siblings and nested plain workspaces', async () => {
    const code = 'export const View = () => <div dangerouslySetInnerHTML={{ __html: "hello" }} />\n'
    const paths = ['apps/[web]/view.jsx', 'apps/w/view.jsx', 'apps/[web]/examples/[plain]/view.jsx']
    const root = project({
      'package.json': { name: 'workspace-globs', type: 'module', workspaces: ['apps/*', 'apps/*/examples/*'] },
      'apps/[web]/package.json': { name: 'react-app', dependencies: { react: '^19.0.0' } },
      'apps/w/package.json': { name: 'plain-sibling' },
      'apps/[web]/examples/[plain]/package.json': { name: 'plain-child' },
      ...Object.fromEntries(paths.map(path => [path, code])),
      'node_modules/eslint-plugin-react-hooks/package.json': {
        name: 'eslint-plugin-react-hooks',
        type: 'module',
        exports: './index.js'
      },
      'node_modules/eslint-plugin-react-hooks/index.js': `const flag = { meta: { schema: [] }, create: context => ({ Program: node => context.report({ node, message: 'scope' }) }) }
export default { rules: { 'rules-of-hooks': flag, 'exhaustive-deps': { create: () => ({}) } } }\n`
    })
    link(root, { eslint: true })
    const policy = mergeLayers([{ source: 'test', input: { engine, rules: { 'react/no-danger': 'error' } } }])
    if (engine === 'eslint') {
      const plan = await eslintPlanFor(root, policy)
      const lint = new ESLint({ cwd: root, overrideConfigFile: true, overrideConfig: plan.config })
      const found: string[] = []
      for (const path of paths) {
        const results = await lint.lintText(code, { filePath: path })
        if (results.some(result => result.messages.some(message => message.ruleId === 'react-hooks/rules-of-hooks')))
          found.push(path)
      }
      expect(found).toEqual(['apps/[web]/view.jsx'])
    } else if (engine === 'biome') {
      write(root, {
        'biome.json': biomeProjectConfig(
          policy,
          biomeContextFor(root, policy, detect(root), { linter: 'biome', formatter: 'biome' })
        )
      })
      const report = await runBiome({ root, files: paths })
      expect(
        report.findings.filter(finding => finding.rule === 'react/no-danger').map(finding => finding.file)
      ).toEqual(['apps/[web]/view.jsx'])
    } else {
      write(root, { '.oxlintrc.json': oxlintConfig(policy, oxlintContextFor(detect(root))) })
      const report = await runOxlint({ root, files: paths })
      expect(
        report.findings.filter(finding => finding.rule === 'react/no-danger').map(finding => finding.file)
      ).toEqual(['apps/[web]/view.jsx'])
    }
  })
})
