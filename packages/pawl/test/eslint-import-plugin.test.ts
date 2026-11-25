import { ESLint, type Linter } from 'eslint'
import { describe, expect, it } from 'vitest'
import { eslintPlan, mergeLayers } from '../src/index.ts'
import { pluginRoot } from './fixtures/eslint/plugins.ts'
import { project } from './helpers.ts'

const IMPORT_RULES = ['import/first', 'import/no-duplicates', 'import/no-extraneous-dependencies']

const SOURCE =
  "export const later = 1\nimport { a } from './a.js'\nimport { b } from './a.js'\nimport pad from 'left-pad'\nconsole.log(a, b, pad)\n"

const planFor = (root: string, pluginRoots: string[] = []) =>
  eslintPlan({ root, policy: mergeLayers([]), biomeActive: false, typescript: false, pluginRoots })

const lint = async (root: string, config: unknown[]): Promise<Linter.LintMessage[]> => {
  const runner = new ESLint({ cwd: root, overrideConfigFile: true, overrideConfig: config as Linter.Config[] })

  return (await runner.lintFiles(['src/index.js'])).flatMap(report => report.messages)
}

const files = {
  'package.json': { name: 'imports', type: 'module' },
  // Installed but not declared: a package an agent imports because it happens to be there.
  'node_modules/left-pad/package.json': { name: 'left-pad', version: '1.3.0', main: 'index.js' },
  'node_modules/left-pad/index.js': 'module.exports = () => ""\n',
  'src/a.js': 'export const a = 1\nexport const b = 2\n',
  'src/index.js': SOURCE
}

describe('the plugin for the import rules', () => {
  it('asks a project with neither plugin for eslint-plugin-import-x, which supports ESLint 10', async () => {
    const plan = await planFor(project(files))

    expect(plan.notEnforced.filter(item => item.rule.startsWith('import/'))).toEqual(
      expect.arrayContaining(IMPORT_RULES.map(rule => ({ rule, needs: 'eslint-plugin-import-x' })))
    )
    expect(plan.notEnforced.map(item => item.needs)).not.toContain('eslint-plugin-import')
  })

  it('runs the import rules with eslint-plugin-import-x under the import namespace', async () => {
    const root = project(files)
    const plan = await planFor(root, [pluginRoot])
    const messages = await lint(root, plan.config)

    expect(plan.notEnforced.filter(item => item.rule.startsWith('import/'))).toEqual([])
    expect(messages.filter(message => message.fatal)).toEqual([])
    expect(messages.map(message => message.ruleId)).toEqual(expect.arrayContaining(IMPORT_RULES))
  })

  it('keeps eslint-plugin-import where the project has it, and leaves out a rule it does not implement', async () => {
    const report = (id: string) =>
      `{ create: context => ({ Program: node => context.report({ node, message: 'eslint-plugin-import ${id}' }) }) }`
    const root = project({
      ...files,
      'node_modules/eslint-plugin-import/package.json': {
        name: 'eslint-plugin-import',
        version: '2.32.0',
        type: 'module',
        exports: './index.js'
      },
      // A plugin without no-duplicates, as an older version would be.
      'node_modules/eslint-plugin-import/index.js': `export default { rules: { first: ${report('first')}, 'no-extraneous-dependencies': ${report('deps')} } }\n`
    })
    const plan = await planFor(root, [pluginRoot])
    const messages = await lint(root, plan.config)

    expect(plan.notEnforced.filter(item => item.rule.startsWith('import/'))).toEqual([
      { rule: 'import/no-duplicates', needs: 'a version of eslint-plugin-import that has it' }
    ])
    expect(messages.filter(message => message.fatal)).toEqual([])
    expect(
      messages.filter(message => message.ruleId?.startsWith('import/')).map(({ ruleId, message }) => [ruleId, message])
    ).toEqual(
      expect.arrayContaining([
        ['import/first', 'eslint-plugin-import first'],
        ['import/no-extraneous-dependencies', 'eslint-plugin-import deps']
      ])
    )
    expect(messages.filter(message => message.ruleId?.startsWith('import/'))).toHaveLength(2)
  })
})
