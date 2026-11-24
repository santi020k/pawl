import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'
import { eslintPlan } from '../src/engines/eslint/plan.ts'
import { resolvePolicy } from '../src/policy/load.ts'
import { MIGRATION_REPORT } from '../src/setup/migrate/migration.ts'
import { planMigrate } from '../src/setup/migrate/plan.ts'
import { applyPlan } from '../src/setup/plan.ts'
import { isRecord } from '../src/utils/json.ts'
import { link, project } from './helpers.ts'

const fixture = (config: string, files: Record<string, string | object> = {}): string => {
  const root = project({
    'package.json': { name: 'migration-scopes', type: 'module' },
    'eslint.config.js': config,
    'src/index.js': 'export const value = 1\n',
    ...files
  })

  link(root, { eslint: true })

  return root
}

/** Compare the engine's resolved values, including defaulted options, rather than policy layout. */
const resolvedRule = async (engine: ESLint, file: string, rule: string): Promise<unknown> => {
  const config: unknown = await engine.calculateConfigForFile(file)

  if (!isRecord(config)) throw new Error(`No configuration resolved for ${file}`)

  const value = isRecord(config.rules) ? config.rules[rule] : undefined

  // An explicit off and an absent rule have the same effect.
  return value === undefined || (Array.isArray(value) && value[0] === 0) ? [0] : value
}

const migrate = async (root: string, parent?: string) => {
  const before = new ESLint({ cwd: root })
  const migration = await planMigrate({ root, ...(parent === undefined ? {} : { extends: parent }) })
  const policy = await resolvePolicy(migration.policy, join(root, 'pawl.config.ts'))
  const plan = await eslintPlan({ root, policy, biomeActive: false, typescript: false })
  const after = new ESLint({ cwd: root, overrideConfigFile: true, overrideConfig: plan.config })

  return { before, after, migration }
}

const expectSame = async (before: ESLint, after: ESLint, files: readonly string[], rules: readonly string[]) => {
  for (const file of files) {
    for (const rule of rules) {
      expect(await resolvedRule(after, file, rule), `${file}: ${rule}`).toEqual(await resolvedRule(before, file, rule))
    }
  }
}

describe('migration preserves ESLint file scopes', { timeout: 60_000 }, () => {
  it('keeps test exceptions without weakening source files, including files created later', async () => {
    const root = fixture(
      `export default [
  { rules: { 'no-debugger': 'error' } },
  { files: ['**/*.test.js'], rules: { 'no-debugger': 'off' } }
]\n`,
      { 'src/index.test.js': 'debugger\n' }
    )
    const { before, after, migration } = await migrate(root)

    await expectSame(
      before,
      after,
      ['src/index.js', 'src/index.test.js', 'new/feature.js', 'new/feature.test.js'],
      ['no-debugger']
    )
    applyPlan(migration)
    expect(readFileSync(join(root, MIGRATION_REPORT), 'utf8')).toContain('**/*.test.js')
    expect(readFileSync(join(root, 'eslint.config.before-pawl.js'), 'utf8')).toContain("'no-debugger': 'off'")
  })

  it('keeps workspace rules separate even when every package uses the same extension', async () => {
    expect.hasAssertions()

    const { before, after } = await migrate(
      fixture(
        `export default [
  { files: ['packages/a/**/*.js'], rules: { 'no-alert': 'error' } },
  { files: ['packages/b/**/*.js'], rules: { 'no-alert': 'warn' } }
]\n`,
        { 'packages/a/index.js': 'alert(1)\n', 'packages/b/index.js': 'alert(2)\n' }
      )
    )

    await expectSame(
      before,
      after,
      ['packages/a/future.js', 'packages/b/future.js', 'packages/c/future.js', 'src/index.js'],
      ['no-alert']
    )
  })

  it('preserves different options at the same severity and an explicit empty-object reset', async () => {
    expect.hasAssertions()

    const { before, after } = await migrate(
      fixture(`export default [
  { rules: { 'no-console': ['error', { allow: ['warn'] }] } },
  { files: ['scripts/**/*.js'], rules: { 'no-console': ['error', { allow: ['log'] }] } },
  { files: ['scripts/strict/**/*.js'], rules: { 'no-console': ['error', {}] } }
]\n`)
    )

    await expectSame(before, after, ['src/index.js', 'scripts/future.js', 'scripts/strict/future.js'], ['no-console'])
  })

  it('preserves the last global level when there are no scoped blocks', async () => {
    expect.hasAssertions()

    const { before, after } = await migrate(
      fixture(`export default [
  { rules: { 'no-debugger': 'error' } },
  { rules: { 'no-debugger': 'off' } }
]\n`)
    )

    await expectSame(before, after, ['src/index.js', 'future.js'], ['no-debugger'])
  })

  it('inherits global options when an override changes only the severity', async () => {
    expect.hasAssertions()

    const { before, after } = await migrate(
      fixture(`export default [
  { rules: { 'no-console': ['error', { allow: ['warn'] }] } },
  { files: ['scripts/**/*.js'], rules: { 'no-console': 'warn' } }
]\n`)
    )

    await expectSame(before, after, ['src/index.js', 'scripts/future.js'], ['no-console'])
  })

  it('preserves ESLint default options instead of adding catalog options to a scoped severity', async () => {
    expect.hasAssertions()

    const { before, after } = await migrate(
      fixture(`export default [
  { rules: { eqeqeq: 'error' } },
  { files: ['scripts/**/*.js'], rules: { eqeqeq: 'warn' } }
]\n`)
    )

    await expectSame(before, after, ['src/index.js', 'scripts/future.js'], ['eqeqeq'])
  })

  it('inherits options when successive overrides use the same file scope', async () => {
    expect.hasAssertions()

    const { before, after } = await migrate(
      fixture(`export default [
  { rules: { 'no-console': ['error', { allow: ['warn'] }] } },
  { files: ['scripts/**/*.js'], rules: { 'no-console': ['error', { allow: ['log'] }] } },
  { files: ['scripts/**/*.js'], rules: { 'no-console': 'warn' } }
]\n`)
    )

    await expectSame(before, after, ['src/index.js', 'scripts/future.js'], ['no-console'])
  })

  it('keeps the company policy floor when the old override loosened a locked rule', async () => {
    const { after, migration } = await migrate(
      fixture(
        `export default [
  { rules: { 'no-debugger': 'error' } },
  { files: ['tests/**/*.js'], rules: { 'no-debugger': 'off' } }
]\n`,
        { 'company.js': "export default { rules: { 'no-debugger': 'error' }, locked: ['no-debugger'] }\n" }
      ),
      './company.js'
    )

    expect(await resolvedRule(after, 'tests/future.js', 'no-debugger')).toEqual([2])
    expect(migration.policy.overrides?.some(override => override.rules?.['no-debugger'] === 'off')).not.toBe(true)
  })

  it('preserves a later global rule after an earlier scoped rule', async () => {
    expect.hasAssertions()

    const { before, after } = await migrate(
      fixture(`export default [
  { rules: { 'no-debugger': 'warn' } },
  { files: ['tests/**/*.js'], rules: { 'no-debugger': 'off' } },
  { rules: { 'no-debugger': 'error' } }
]\n`)
    )

    await expectSame(before, after, ['src/index.js', 'tests/future.js'], ['no-debugger'])
  })

  it('preserves scopes supplied by a shared config', async () => {
    expect.hasAssertions()

    const { before, after } = await migrate(
      fixture("import shared from 'eslint-config-shared'\nexport default [...shared]\n", {
        'node_modules/eslint-config-shared/package.json': {
          name: 'eslint-config-shared',
          type: 'module',
          exports: './index.js'
        },
        'node_modules/eslint-config-shared/index.js': `export default [
  { rules: { 'no-debugger': 'error' } },
  { files: ['tests/**/*.js'], rules: { 'no-debugger': 'off' } }
]\n`
      })
    )

    await expectSame(before, after, ['src/index.js', 'tests/future.js', 'other/tests/future.js'], ['no-debugger'])
  })

  it('keeps ESLint patterns without a slash anchored at the project root', async () => {
    expect.hasAssertions()

    const { before, after } = await migrate(
      fixture(`export default [
  { rules: { 'no-debugger': 'error' } },
  { files: ['*.js'], rules: { 'no-debugger': 'off' } }
]\n`)
    )

    await expectSame(before, after, ['future.js', 'src/future.js', 'src/nested/future.js'], ['no-debugger'])
  })

  it('keeps every brace alternative anchored even when only one alternative contains a slash', async () => {
    expect.hasAssertions()

    const { before, after } = await migrate(
      fixture(`export default [
  { rules: { 'no-debugger': 'error' } },
  { files: ['{a,b/c}.js'], rules: { 'no-debugger': 'off' } }
]\n`)
    )

    await expectSame(before, after, ['a.js', 'b/c.js', 'nested/a.js', 'nested/b/c.js'], ['no-debugger'])
  })

  it('refuses a pack preset that would inject options absent from the scoped source rule', async () => {
    const config = `import storybook from 'eslint-plugin-storybook'
export default [{ files: ['src/**/*.js'], plugins: { storybook }, rules: { 'storybook/demo': 'error' } }]
`
    const root = fixture(config, {
      'node_modules/eslint-plugin-storybook/package.json': {
        name: 'eslint-plugin-storybook',
        type: 'module',
        exports: './index.js'
      },
      'node_modules/eslint-plugin-storybook/index.js': `const plugin = {
  rules: {
    demo: {
      meta: { type: 'problem', schema: [{ type: 'object', properties: { mode: { type: 'string' } } }] },
      create: () => ({})
    }
  },
  configs: {}
}
plugin.configs['flat/recommended'] = [
  { plugins: { storybook: plugin }, rules: { 'storybook/demo': ['error', { mode: 'preset' }] } }
]
export default plugin
`
    })

    await expect(planMigrate({ root })).rejects.toThrow(/options/i)
    expect(readFileSync(join(root, 'eslint.config.js'), 'utf8')).toBe(config)
    expect(existsSync(join(root, 'eslint.config.before-pawl.js'))).toBe(false)
    expect(existsSync(join(root, 'pawl.config.ts'))).toBe(false)
    expect(existsSync(join(root, MIGRATION_REPORT))).toBe(false)
  })

  it.each([
    "{ files: ['src/**/*.js'], linterOptions: { noInlineConfig: true } }",
    "{ ignores: ['ignored.js'], linterOptions: { noInlineConfig: true } }"
  ])('refuses linterOptions scopes before inline comments can weaken rules: %s', async scopedOptions => {
    const config = `export default [
  { rules: { 'no-debugger': 'error' } },
  ${scopedOptions}
]\n`
    const root = fixture(config)
    const before = new ESLint({ cwd: root })
    const directive = ['//', 'eslint-disable-next-line', 'no-debugger'].join(' ')
    const code = `${directive}\ndebugger;\n`
    const diagnostics = await before.lintText(code, { filePath: 'src/future.js' })

    expect(
      diagnostics.flatMap(result => result.messages).filter(message => message.ruleId === 'no-debugger')
    ).toHaveLength(1)
    // Negative control: dropping this option lets the same inline comment suppress the rule.
    const withoutOption = new ESLint({
      cwd: root,
      overrideConfigFile: true,
      overrideConfig: [{ files: ['src/**/*.js'], rules: { 'no-debugger': 'error' } }]
    })
    const weakened = await withoutOption.lintText(code, { filePath: 'src/future.js' })

    expect(
      weakened.flatMap(result => result.messages).filter(message => message.ruleId === 'no-debugger')
    ).toHaveLength(0)
    await expect(planMigrate({ root })).rejects.toThrow(/scoped.*linterOptions|local ignores/i)
    expect(readFileSync(join(root, 'eslint.config.js'), 'utf8')).toBe(config)
    expect(existsSync(join(root, 'eslint.config.before-pawl.js'))).toBe(false)
    expect(existsSync(join(root, 'pawl.config.ts'))).toBe(false)
    expect(existsSync(join(root, MIGRATION_REPORT))).toBe(false)
  })

  it('refuses ambiguous option inheritance across overlapping scopes before writing', async () => {
    const config = `export default [
  { files: ['scripts/**/*.js'], rules: { 'no-console': ['error', { allow: ['log'] }] } },
  { files: ['**/*.js'], rules: { 'no-console': 'warn' } }
]\n`
    const root = fixture(config)

    await expect(planMigrate({ root })).rejects.toThrow(/options|scope|inherit/i)
    expect(readFileSync(join(root, 'eslint.config.js'), 'utf8')).toBe(config)
    expect(existsSync(join(root, 'pawl.config.ts'))).toBe(false)
    expect(existsSync(join(root, MIGRATION_REPORT))).toBe(false)
  })

  it.each([
    "{ files: [['src/**', '**/*.js']], rules: { 'no-debugger': 'off' } }",
    "{ files: ['src/{1..3}.js'], rules: { 'no-debugger': 'off' } }",
    "{ files: ['src/**/*.js'], ignores: ['src/private/**'], rules: { 'no-debugger': 'off' } }",
    "{ files: ['src/**/*.js'], languageOptions: { globals: { customGlobal: 'readonly' } } }"
  ])('refuses an unrepresentable scope before replacing any files: %s', async scope => {
    const config = `export default [{ rules: { 'no-debugger': 'error' } }, ${scope}]\n`
    const root = fixture(config)

    await expect(planMigrate({ root })).rejects.toThrow(/scope|override|files|ignores/i)
    expect(readFileSync(join(root, 'eslint.config.js'), 'utf8')).toBe(config)
    expect(existsSync(join(root, 'eslint.config.before-pawl.js'))).toBe(false)
    expect(existsSync(join(root, 'pawl.config.ts'))).toBe(false)
    expect(existsSync(join(root, MIGRATION_REPORT))).toBe(false)
  })
})
