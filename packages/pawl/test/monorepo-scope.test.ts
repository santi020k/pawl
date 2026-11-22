import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { check } from '../src/check.ts'
import { detect } from '../src/detect.ts'
import { eslintPlan, eslintPlanFor } from '../src/engines/eslint.ts'
import { oxlintConfig, oxlintContextFor, runOxlint } from '../src/engines/oxlint.ts'
import { defaultPolicy, mergeLayers } from '../src/policy.ts'
import { link, PACKAGE_ROOT, project, write } from './helpers.ts'

const manifest = (name: string): object => ({ name, type: 'module', exports: './index.js' })

/** A stand-in for eslint-plugin-react-hooks with the two rules of the standard. */
const HOOKS = "export default { rules: { 'rules-of-hooks': {}, 'exhaustive-deps': {} } }\n"

/** A React app and a Vue app side by side, the root depending on neither. */
const mixed = (extra: Record<string, string | object> = {}): string =>
  project({
    'package.json': { name: 'repo', private: true, type: 'module', workspaces: ['apps/*'] },
    'apps/web/package.json': { name: 'web', dependencies: { react: '^19.0.0' } },
    'apps/admin/package.json': { name: 'admin', dependencies: { vue: '^3.5.0' } },
    ...extra
  })

type Block = { name: string; files?: unknown[]; rules?: Record<string, unknown>; plugins?: Record<string, unknown> }

describe('a monorepo that mixes stacks', () => {
  it('gives Oxlint the React rules, and the plugins they need, for the React app only', () => {
    const root = mixed()
    const config = oxlintConfig(defaultPolicy(), oxlintContextFor(detect(root))) as {
      plugins: string[]
      rules: Record<string, unknown>
      overrides?: { files: string[]; plugins?: string[]; rules: Record<string, unknown> }[]
    }

    // A plugin switched on at the top runs its default rules everywhere, so React's is not there.
    expect(config.plugins).not.toContain('react')
    expect(config.rules['react/jsx-key']).toBeUndefined()

    const web = config.overrides?.find(override => override.files.includes('apps/web/**'))

    expect(web?.plugins).toEqual(expect.arrayContaining(['react', 'jsx-a11y']))
    expect(web?.rules).toMatchObject({ 'react/jsx-key': 'error', 'react/rules-of-hooks': 'error' })
    // Vue's rules Oxlint has go to the Vue app.
    expect(config.overrides?.find(override => override.files.includes('apps/admin/**'))?.rules).toHaveProperty(
      'vue/require-prop-types'
    )
  })

  it('keeps the rules the whole repo uses at the top, and the policy overrides after the packages', () => {
    const root = mixed({ 'package.json': { name: 'repo', workspaces: ['apps/*'], dependencies: { react: '^19.0.0' } } })
    const policy = mergeLayers([
      { source: 'repo', input: { overrides: [{ files: ['apps/admin/**'], rules: { 'react/jsx-key': 'off' } }] } }
    ])
    const config = oxlintConfig(policy, oxlintContextFor(detect(root))) as {
      plugins: string[]
      rules: Record<string, unknown>
      overrides: { files: string[]; rules: Record<string, unknown> }[]
    }

    expect(config.plugins).toContain('react')
    expect(config.rules['react/jsx-key']).toBe('error')
    expect(config.overrides.at(-1)).toEqual({ files: ['apps/admin/**'], rules: { 'react/jsx-key': 'off' } })
  })

  it('reports a React rule from the real Oxlint in the React app and not in the Vue app', async () => {
    const component = 'export const List = ({ items }) => <ul>{items.map(item => <li>{item}</li>)}</ul>\n'
    const root = mixed({ 'apps/web/src/list.jsx': component, 'apps/admin/src/list.jsx': component })

    link(root)
    write(root, { '.oxlintrc.json': oxlintConfig(defaultPolicy(), oxlintContextFor(detect(root))) })

    const { findings } = await runOxlint({ root })
    const keyed = findings.filter(finding => finding.rule === 'react/jsx-key').map(finding => finding.file)

    expect(keyed).toEqual(['apps/web/src/list.jsx'])
  })

  it('gives ESLint the React rules, and a pack only the React app depends on, for the React app only', async () => {
    const root = mixed({
      'node_modules/eslint-plugin-react-hooks/package.json': manifest('eslint-plugin-react-hooks'),
      'node_modules/eslint-plugin-react-hooks/index.js': HOOKS
    })
    const policy = mergeLayers([{ source: 'repo', input: { engine: 'eslint' } }])
    const plan = await eslintPlanFor(root, policy)
    const blocks = plan.config as Block[]
    const pack = blocks.find(block => block.name === 'pawl/pack/react-hooks')
    const base = blocks.find(block => block.name === 'pawl/base')
    const scoped = blocks.find(block => block.name === 'pawl/pack/react-hooks/apps/web')

    expect(plan.activePacks).toContain('react-hooks')
    expect(pack?.files).toEqual(['apps/web/**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}'])
    // The React catalog rules leave the repo-wide blocks, and keep to the React app's files.
    expect(pack?.rules?.['react-hooks/rules-of-hooks']).toBeUndefined()
    expect(base?.rules?.['react-hooks/rules-of-hooks']).toBeUndefined()
    expect(scoped?.files).toEqual(['apps/web/**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}'])
    expect(scoped?.rules).toMatchObject({ 'react-hooks/rules-of-hooks': 'error' })
    expect(Object.keys(scoped?.plugins ?? {})).toEqual(['react-hooks'])
    expect(blocks.some(block => block.name.includes('apps/admin') && JSON.stringify(block).includes('react'))).toBe(
      false
    )
  })

  it('leaves ESLint as it was for a single package and for a pack the root depends on', async () => {
    const plugin = {
      'node_modules/eslint-plugin-react-hooks/package.json': manifest('eslint-plugin-react-hooks'),
      'node_modules/eslint-plugin-react-hooks/index.js': HOOKS
    }
    const single = await eslintPlan({
      root: project({ 'package.json': { name: 'app' }, ...plugin }),
      policy: defaultPolicy(),
      biomeActive: false,
      typescript: false,
      technologies: ['react'],
      dependencies: ['react']
    })

    expect((single.config as Block[]).find(block => block.name === 'pawl/pack/react-hooks')?.files).toEqual([
      '**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}'
    ])

    const root = mixed({
      'package.json': { name: 'repo', workspaces: ['apps/*'], dependencies: { react: '^19.0.0' } },
      ...plugin
    })
    const plan = await eslintPlanFor(root, mergeLayers([{ source: 'repo', input: { engine: 'eslint' } }]))
    const pack = (plan.config as Block[]).find(block => block.name === 'pawl/pack/react-hooks')

    expect(pack?.files).toEqual(['**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}'])
    expect(pack?.rules).toMatchObject({ 'react-hooks/rules-of-hooks': 'error' })
  })

  it.runIf(existsSync(join(PACKAGE_ROOT, 'dist/index.js')))(
    'runs the React rules in the React app only, under the real ESLint',
    async () => {
      // A stand-in rule that flags every file it runs on, so where it runs is what is tested.
      const plugin =
        "const flag = { meta: { type: 'problem', schema: [] }, create: context => ({ Program: node => context.report({ node, message: 'hooks' }) }) }\n" +
        "export default { rules: { 'rules-of-hooks': flag, 'exhaustive-deps': flag } }\n"
      const root = mixed({
        'pawl.config.json': { engine: 'eslint', formatter: 'prettier' },
        'eslint.config.js':
          "import { eslint } from '@santi020k/pawl'\n\nexport default eslint({ root: import.meta.dirname })\n",
        '.prettierrc.json': '{}\n',
        'node_modules/eslint-plugin-react-hooks/package.json': manifest('eslint-plugin-react-hooks'),
        'node_modules/eslint-plugin-react-hooks/index.js': plugin,
        'apps/web/src/a.js': 'export const a = 1\n',
        'apps/admin/src/a.js': 'export const a = 1\n'
      })

      link(root, { eslint: true, prettier: true })

      const result = await check({ root })
      const hooks = result.findings.filter(finding => finding.rule === 'react-hooks/rules-of-hooks')

      expect(result.setup.filter(issue => issue.code === 'engine-failed')).toEqual([])
      expect(hooks.map(finding => finding.file)).toEqual(['apps/web/src/a.js'])
    }
  )
})
