import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_STYLE as defaultStyle } from '../src/policy/merge.ts'
import { MIGRATION_REPORT } from '../src/setup/migrate/migration.ts'
import { planMigrate } from '../src/setup/migrate/plan.ts'
import { describeMigration } from '../src/setup/migrate/report.ts'
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

    // What the config leaves out is what Prettier does by itself: 80 columns, trailing commas, arrow parentheses.
    expect(plan.policy.style).toEqual({ indent: 4, lineWidth: 80, trailingCommas: 'all', arrowParens: 'always' })
  })

  it("keeps Prettier's own defaults as the style of a project that set no options", async () => {
    const plan = await planMigrate({ root: fixture({ '.prettierrc': '{\n  // The defaults.\n}\n' }) })

    expect(plan.policy.style).toEqual({
      quotes: 'double',
      semicolons: true,
      trailingCommas: 'all',
      lineWidth: 80,
      arrowParens: 'always'
    })
    expect(plan.notes.join(' ')).not.toContain('Could not read the Prettier config')
  })

  it('reads .editorconfig for what the Prettier config leaves out, as the real Prettier resolves it', async () => {
    const prettier = (await import('prettier')) as typeof import('prettier')
    const cases = [
      '[*]\nindent_style = space\nindent_size = 4\nmax_line_length = 120\n',
      'root = true\n\n[*]\nindent_style = tab\ntab_width = 8\n\n[*.{js,ts}]\nquote_type = single\n',
      '[*.md]\nindent_size = 4\n\n[*]\nindent_style = space\nindent_size = 2\nmax_line_length = off\n',
      '[*.py]\nindent_size = 4\n',
      // One width stands for the other, as the EditorConfig parser fills them in.
      '[*]\nindent_size = 4\n',
      '[*]\nindent_style = tab\nindent_size = 4\n',
      '[*]\nindent_size = tab\ntab_width = 4\n',
      '[*]\nindent_style = space\ntab_width = 4\n',
      '[*]\nindent_style = tab\n'
    ]

    for (const editorconfig of cases) {
      const root = fixture({ '.prettierrc': { semi: false }, '.editorconfig': editorconfig, '.git/HEAD': '' })
      const plan = await planMigrate({ root })
      const resolved = (await prettier.resolveConfig(join(root, 'src/index.ts'), { editorconfig: true })) ?? {}
      const style = { ...defaultStyle, ...plan.policy.style }

      expect(style.indent, editorconfig).toBe(resolved.useTabs ? 'tab' : (resolved.tabWidth ?? 2))
      expect(style.quotes, editorconfig).toBe(resolved.singleQuote ? 'single' : 'double')
      expect(style.lineWidth, editorconfig).toBe(
        // No limit at all is the widest Biome formats to.
        resolved.printWidth === Number.POSITIVE_INFINITY ? 320 : (resolved.printWidth ?? 80)
      )
      expect(style.semicolons, editorconfig).toBe(false)
    }
  })

  it('lists out the character classes of the old ignores, and keeps a pattern that names a path with brackets', async () => {
    const plan = await planMigrate({
      root: fixture({
        'eslint.config.js': `export default [{ ignores: ${JSON.stringify([
          '**/*.min.[jc]s',
          'legacy/v[1-3]/**',
          'src/app/[slug]/**',
          'x/[!a]b',
          'y/[a-z][a-z]',
          '**/*.{gen,auto}.ts',
          '@(a|b)/**',
          'z/[z-a]/**',
          'src/+(a|b).js'
        ])} }, { rules: { 'no-var': 'error' } }]\n`,
        'src/app/[slug]/page.js': 'export const a = 1\n'
      })
    })

    // Brackets in a pawl pattern are the characters themselves, as in the route folder.
    expect(plan.policy.ignore).toEqual([
      '**/*.min.js',
      '**/*.min.cs',
      'legacy/v1',
      'legacy/v2',
      'legacy/v3',
      'src/app/[slug]',
      // Braces are read as a glob reads them, so they stay.
      '**/*.{gen,auto}.ts',
      'a',
      'b'
    ])

    for (const pattern of ['x/[!a]b', 'y/[a-z][a-z]', 'z/[z-a]', 'src/+(a|b).js']) {
      expect(plan.notes).toContain(
        `The ignore pattern "${pattern}" has a part pawl cannot list out, such as a character class or an extglob. Add the paths it skips to "ignore" in the policy.`
      )
    }
  })

  it('keeps a line width the policy can hold, when the old one is wider than Biome formats to', async () => {
    const plan = await planMigrate({ root: fixture({ '.prettierrc': { printWidth: 1000 } }) })

    expect(plan.policy.style?.lineWidth).toBe(320)
  })

  it('says so when the Prettier config is one it cannot read', async () => {
    const plan = await planMigrate({ root: fixture({ 'prettier.config.js': 'export default { semi: false }\n' }) })

    // The style then comes from the old formatting rules alone.
    expect(plan.policy.style).toEqual({ quotes: 'double', semicolons: true, lineWidth: 100 })
    expect(plan.notes).toContain(
      'Could not read the Prettier config in prettier.config.js. Set "style" in the policy to match it, or "pawl fix" will format the code to the standard\'s style.'
    )
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
