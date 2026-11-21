import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { describeMigration, MIGRATION_REPORT, planMigrate } from '../src/setup/migrate.ts'
import { applyPlan } from '../src/setup/plan.ts'
import { link, PACKAGE_ROOT, project } from './helpers.ts'

const manifest = (name: string): object => ({ name, type: 'module', exports: './index.js' })

/** A stand-in for eslint-plugin-unicorn: 24 rules, all in its recommended preset. */
const UNICORN = `const names = Array.from({ length: 24 }, (_, index) => 'rule-' + index)
const rule = { meta: { type: 'suggestion', schema: [] }, create: () => ({}) }

export default {
  rules: Object.fromEntries(names.map(name => [name, rule])),
  configs: { recommended: { rules: Object.fromEntries(names.map(name => ['unicorn/' + name, 'error'])) } }
}
`

/** A stand-in plugin pawl has no pack for, with one formatting rule and one that takes options. */
const DEMO = `export default {
  rules: {
    pad: { meta: { type: 'layout', schema: [] }, create: () => ({}) },
    logic: { meta: { type: 'problem', schema: [{ type: 'object', additionalProperties: true }] }, create: () => ({}) }
  }
}
`

const OLD_CONFIG = `import unicorn from 'eslint-plugin-unicorn'
import demo from 'eslint-plugin-demo'

export default [
  { ignores: ['generated/**', 'dist/**'] },
  {
    plugins: { unicorn, demo },
    rules: {
      ...unicorn.configs.recommended.rules,
      'unicorn/rule-3': 'warn',
      'no-var': 'error',
      'no-console': 'off',
      'no-restricted-syntax': ['error', 'WithStatement'],
      quotes: ['error', 'double'],
      semi: ['error', 'always'],
      'max-len': ['warn', { code: 100 }],
      'sort-imports': 'warn',
      'demo/pad': 'error',
      'demo/logic': ['warn', { allow: ['x'] }]
    }
  }
]
`

const fixture = (files: Record<string, string | object> = {}): string => {
  const root = project({
    'package.json': { name: 'old-app', type: 'module' },
    'eslint.config.js': OLD_CONFIG,
    'src/index.js': 'export const a = 1\n',
    'node_modules/eslint-plugin-unicorn/package.json': manifest('eslint-plugin-unicorn'),
    'node_modules/eslint-plugin-unicorn/index.js': UNICORN,
    'node_modules/eslint-plugin-demo/package.json': manifest('eslint-plugin-demo'),
    'node_modules/eslint-plugin-demo/index.js': DEMO,
    ...files
  })

  link(root, { eslint: true })

  return root
}

describe('migrating from an ESLint config, with the real ESLint', { timeout: 60_000 }, () => {
  it('writes a policy that keeps what differs from the standard and nothing else', async () => {
    const plan = await planMigrate({ root: fixture() })

    expect(plan.source).toBe('eslint.config.js')
    expect(plan.samples).toEqual(['src/index.js'])
    // The old config follows the plugin's own preset, so the pack starts from it.
    expect(plan.policy.packs).toEqual(['unicorn/recommended'])
    expect(plan.policy.style).toEqual({ quotes: 'double', semicolons: true, lineWidth: 100 })
    expect(plan.policy.ignore).toEqual(['generated'])
    expect(plan.policy.rules).toMatchObject({
      'no-console': 'off',
      'no-restricted-syntax': 'error',
      'unicorn/rule-3': 'warn',
      'demo/logic': 'warn'
    })
    // Already the standard, or already what the preset sets.
    expect(plan.policy.rules).not.toHaveProperty('no-var')
    expect(plan.policy.rules).not.toHaveProperty('unicorn/rule-4')
    expect(plan.policy.options).toEqual({
      'demo/logic': [{ allow: ['x'] }],
      'no-restricted-syntax': ['WithStatement']
    })
    expect(plan.formatting).toEqual(['demo/pad', 'max-len', 'quotes', 'semi'])
    expect(plan.importSorting).toEqual(['sort-imports'])
    expect(plan.notEnforced).toEqual([])
    expect(plan.added).toContain('no-debugger')
    expect(describeMigration(plan).join('\n')).toContain('Packs  unicorn/recommended')
  })

  it('swaps the ESLint config, keeps the old one, and writes a report', async () => {
    const root = fixture()
    const plan = await planMigrate({ root })

    applyPlan(plan)

    expect(readFileSync(join(root, 'eslint.config.before-pawl.js'), 'utf8')).toBe(OLD_CONFIG)
    expect(readFileSync(join(root, 'eslint.config.js'), 'utf8')).toContain(
      'export default eslint({ root: import.meta.dirname })'
    )

    const policy = readFileSync(join(root, 'pawl.config.ts'), 'utf8')

    expect(policy).toContain("packs: ['unicorn/recommended']")
    expect(policy).toContain("'no-restricted-syntax': ['WithStatement']")
    expect(policy).toContain("    quotes: 'double',\n")

    const report = readFileSync(join(root, MIGRATION_REPORT), 'utf8')

    expect(report).toContain('| `no-console` | warn | off |')
    expect(report).toContain('- `quotes`')
  })

  it('leaves the ESLint config alone when asked to', async () => {
    const root = fixture()
    const plan = await planMigrate({ root, keepConfig: true })

    applyPlan(plan)

    expect(plan.actions.map(action => action.path)).toEqual(['pawl.config.ts', MIGRATION_REPORT])
    expect(readFileSync(join(root, 'eslint.config.js'), 'utf8')).toBe(OLD_CONFIG)
    expect(existsSync(join(root, 'eslint.config.before-pawl.js'))).toBe(false)
  })

  it('takes the style from a Prettier config over the old formatting rules', async () => {
    const plan = await planMigrate({
      root: fixture({ '.prettierrc': { singleQuote: true, semi: false, tabWidth: 4 } })
    })

    expect(plan.policy.style).toEqual({ indent: 4, lineWidth: 100 })
  })

  it('shows the plan and changes nothing on a dry run, through the command line', () => {
    const root = fixture()
    const run = (script: string, args: string[]) =>
      spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8' })
    const migrated = run(join(PACKAGE_ROOT, 'src/cli.ts'), ['migrate', '--yes', '--dry-run'])

    expect(migrated.stdout).toContain('Dry run. Nothing was changed.')
    expect(existsSync(join(root, 'pawl.config.ts'))).toBe(false)
  })

  it('says why when there is nothing to migrate', async () => {
    await expect(planMigrate({ root: project({ 'package.json': { name: 'empty' } }) })).rejects.toThrow(
      'No ESLint config here'
    )
    await expect(
      planMigrate({
        root: fixture({ 'eslint.config.js': "import { eslint } from '@santi020k/pawl'\n\nexport default eslint()\n" })
      })
    ).rejects.toThrow('already built from')
    await expect(planMigrate({ root: fixture({ 'pawl.config.json': {} }) })).rejects.toThrow('already exists')
  })
})

describe('policy options', () => {
  it('reach the ESLint config for rules ESLint runs', async () => {
    const { eslintPlan } = await import('../src/engines/eslint/plan.ts')
    const { mergeLayers } = await import('../src/policy/merge.ts')
    const policy = mergeLayers([
      {
        source: 'test',
        input: {
          rules: { 'no-restricted-syntax': 'error' },
          options: { 'no-restricted-syntax': ['WithStatement'], eqeqeq: ['smart'] }
        }
      }
    ])
    const plan = await eslintPlan({
      root: project({ 'package.json': { name: 'x' } }),
      policy,
      biomeActive: false,
      typescript: false
    })
    const base = plan.config.find(entry => entry.name === 'pawl/base') as { rules: Record<string, unknown> }

    expect(base.rules['no-restricted-syntax']).toEqual(['error', 'WithStatement'])
    expect(base.rules.eqeqeq).toEqual(['error', 'smart'])
  })
})
