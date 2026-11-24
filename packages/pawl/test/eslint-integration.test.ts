import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'
import { check, eslint, eslintPlanFor, exitCode } from '../src/index.ts'
import { link, project } from './helpers.ts'

const fixture = (): string =>
  project({
    'package.json': { name: 'consumer', type: 'module' },
    'pawl.config.json': { engine: 'biome', rules: { 'custom/no-debugger': 'error' } }
  })

const plugin = {
  rules: {
    'no-debugger': {
      meta: { schema: [], messages: { forbidden: 'Remove the debugger.' } },
      create(context: { report: (problem: { node: unknown; messageId: string }) => void }) {
        return {
          DebuggerStatement(node: unknown) {
            context.report({ node, messageId: 'forbidden' })
          }
        }
      }
    }
  }
}

// ESLint accepts structural configs from the public helper; it owns their runtime validation.
const run = async (root: string, code: string): Promise<string[]> => {
  const config = await eslint({ root, plugins: { custom: plugin } })
  const runner = new ESLint({ cwd: root, overrideConfigFile: true, overrideConfig: config })
  const reports = await runner.lintText(code, { filePath: 'src/index.js' })
  return reports.flatMap(report => report.messages.map(message => message.ruleId ?? 'parse'))
}

describe('public ESLint integrations', () => {
  it('registers an explicit namespace and runs its implementation with real ESLint', async () => {
    const root = fixture()
    expect(await run(root, 'debugger;')).toContain('custom/no-debugger')
    expect(await run(root, 'export const value = 1;')).not.toContain('custom/no-debugger')
  })

  it('rejects absent and non-callable requested implementations, but permits disabled rules', async () => {
    const root = fixture()
    for (const custom of [{ rules: {} }, { rules: { 'no-debugger': { create: 'invalid' } } }]) {
      const plan = await eslintPlanFor(root, undefined, { plugins: { custom } })
      expect(plan.notEnforced).toContainEqual(expect.objectContaining({ rule: 'custom/no-debugger', required: true }))
      await expect(eslint({ root, plugins: { custom } })).rejects.toThrow('custom/no-debugger')
    }
    const disabled = project({
      'package.json': { name: 'consumer' },
      'pawl.config.json': { engine: 'biome', rules: { 'custom/no-debugger': 'off' } }
    })
    await expect(eslint({ root: disabled, plugins: { custom: { rules: {} } } })).resolves.toBeDefined()
  })

  it('finds the plugin a flat preset registers in one block for the rules it sets in the next', async () => {
    // eslint-plugin-vue, eslint-plugin-yml, eslint-plugin-storybook and others ship their flat preset
    // as several blocks: the first registers the plugin, the later ones set its rules.
    const root = project({
      'package.json': { name: 'consumer', type: 'module', devDependencies: { 'eslint-plugin-yml': '1.0.0' } },
      'pawl.config.json': { engine: 'eslint', packs: ['yaml'] },
      'node_modules/eslint-plugin-yml/package.json': {
        name: 'eslint-plugin-yml',
        version: '3.0.0',
        type: 'module',
        exports: './index.js'
      },
      'node_modules/eslint-plugin-yml/index.js': [
        'const rule = { create() { return {} } }',
        'const plugin = { rules: { "no-empty-key": rule, "no-empty-mapping-value": rule } }',
        'plugin.configs = {',
        '  "flat/recommended": [',
        '    { plugins: { yml: plugin } },',
        '    { files: ["**/*.yml"], rules: { "yml/no-empty-key": "error" } },',
        '    { rules: { "yml/no-empty-mapping-value": "error" } }',
        '  ]',
        '}',
        'export default plugin'
      ].join('\n')
    })
    const plan = await eslintPlanFor(root)

    expect(plan.notEnforced.filter(item => item.rule.startsWith('yml/'))).toEqual([])
    await expect(eslint({ root })).resolves.toBeDefined()

    // The preset's block with no files keeps to scripts and YAML, away from what other packs parse.
    const unscoped = plan.config.find(block => Object.keys(block.rules ?? {}).includes('yml/no-empty-mapping-value'))
    expect(unscoped?.files).toEqual(['**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}', '**/*.{yml,yaml}'])
    expect(plan.config.find(block => Object.keys(block.rules ?? {}).includes('yml/no-empty-key'))?.files).toEqual([
      '**/*.yml'
    ])
  })

  it('resolves plugins through public exports in additional shared-config roots', async () => {
    const root = fixture()
    const shared = project({
      'package.json': { name: 'shared' },
      'node_modules/eslint-plugin-custom/package.json': {
        name: 'eslint-plugin-custom',
        type: 'module',
        exports: './public.js'
      },
      'node_modules/eslint-plugin-custom/public.js':
        'export default { rules: { "no-debugger": { create() { return {} } } } }'
    })
    const plan = await eslintPlanFor(root, undefined, { pluginRoots: [shared] })
    expect(plan.notEnforced.filter(item => item.rule === 'custom/no-debugger')).toEqual([])
    await expect(eslint({ root, pluginRoots: [shared] })).resolves.toBeDefined()
    await expect(eslint({ root })).rejects.toThrow('custom/no-debugger')
  })
  it('reports unavailable requested rules as a blocking setup failure through real ESLint', async () => {
    const root = project({
      'package.json': { name: 'consumer', type: 'module' },
      'pawl.config.json': { engine: 'eslint', formatter: 'prettier', rules: { 'custom/missing': 'error' } },
      '.prettierrc.json': '{}\n',
      'src/index.js': 'export const value = 1;\n',
      'eslint.config.js': `import { eslint } from ${JSON.stringify(new URL('../src/index.ts', import.meta.url).href)}; export default eslint({ root: import.meta.dirname, plugins: { custom: { rules: {} } } });`
    })
    link(root, { eslint: true, prettier: true })
    const result = await check({ root })
    expect(exitCode(result)).toBe(2)
    expect(result.setup.some(issue => issue.code === 'engine-failed' && issue.message.includes('custom/missing'))).toBe(
      true
    )
  })
})
