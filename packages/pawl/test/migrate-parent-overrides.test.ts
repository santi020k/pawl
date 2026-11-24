import { existsSync, readFileSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'
import { biomeProjectConfig } from '../src/engines/biome/config.ts'
import { runBiome } from '../src/engines/biome/run.ts'
import { eslintPlan } from '../src/engines/eslint/plan.ts'
import { resolvePolicy } from '../src/policy/load.ts'
import { MIGRATION_REPORT } from '../src/setup/migrate/migration.ts'
import { planMigrate } from '../src/setup/migrate/plan.ts'
import { isRecord } from '../src/utils/json.ts'
import { link, PACKAGE_ROOT, project, write } from './helpers.ts'

const source = `export default [
  { files: ['tests/**/*.js'], rules: { 'no-debugger': 'off' } },
  { files: ['tests/strict/**/*.js'], rules: { 'no-debugger': 'error' } }
]\n`
const parent = `export default {
  rules: { 'no-debugger': 'error', 'no-console': 'error' },
  overrides: [{ files: ['scripts/**'], rules: { 'no-console': 'off' } }]
}\n`
const fixture = (config = source, company = parent): string => {
  const root = project({
    'package.json': { name: 'parent-scopes', type: 'module' },
    'eslint.config.js': config,
    'company.js': company,
    'src/index.js': 'debugger\n',
    'tests/index.js': 'debugger\n',
    'tests/strict/index.js': 'debugger\n',
    'scripts/task.js': 'console.log(1)\n'
  })
  link(root, { eslint: true })
  return root
}
const migrated = async (root: string, onto = './company.js') => {
  const migration = await planMigrate({ root, extends: onto })
  const policy = await resolvePolicy(migration.policy, join(root, 'pawl.config.ts'))
  const plan = await eslintPlan({ root, policy, biomeActive: false, typescript: false })
  const engine = new ESLint({ cwd: root, overrideConfigFile: true, overrideConfig: plan.config })
  return { migration, policy, engine }
}
const rule = async (engine: ESLint, file: string, name: string): Promise<unknown> => {
  const config: unknown = await engine.calculateConfigForFile(file)
  if (!isRecord(config) || !isRecord(config.rules)) throw new Error(`No rules for ${file}`)
  return config.rules[name]
}

describe('migration onto parent scopes', () => {
  it('replays explicit source scopes and retains unrelated parent script exceptions', async () => {
    const root = fixture()
    const { engine, policy } = await migrated(root)
    for (const file of ['tests/index.js', 'tests/future.js']) {
      expect(await rule(engine, file, 'no-debugger')).toEqual([0])
    }
    for (const file of ['src/index.js', 'src/future.js', 'tests/strict/future.js']) {
      expect(await rule(engine, file, 'no-debugger')).toEqual([2])
    }
    expect(await rule(engine, 'scripts/future.js', 'no-console')).toEqual([0, {}])
    write(root, { 'biome.json': biomeProjectConfig(policy) })
    const report = await runBiome({
      root,
      files: ['src/index.js', 'tests/index.js', 'tests/strict/index.js', 'scripts/task.js']
    })
    expect(
      report.findings
        .filter(finding => finding.rule === 'no-debugger')
        .map(finding => finding.file)
        .sort()
    ).toEqual(['src/index.js', 'tests/strict/index.js'])
    expect(report.findings.filter(finding => finding.rule === 'no-console')).toEqual([])
  })

  it('replays explicit global rules over parent exceptions even without a matching source scope', async () => {
    const root = fixture(
      `export default [
      { rules: { 'no-debugger': 'error' } },
      { files: ['scripts/**/*.js'], rules: { 'no-alert': 'error' } }
    ]\n`,
      `export default {
      rules: { 'no-debugger': 'error' },
      overrides: [{ files: ['tests/**'], rules: { 'no-debugger': 'off' } }]
    }\n`
    )
    const { engine, migration } = await migrated(root)
    expect(await rule(engine, 'tests/future.js', 'no-debugger')).toEqual([2])
    const result = await engine.lintText('debugger', { filePath: 'tests/future.js' })
    expect(result.flatMap(item => item.messages).some(message => message.ruleId === 'no-debugger')).toBe(true)
    expect(migration.policyKept.filter(change => change.rule === 'no-debugger')).toEqual([])
  })

  it('does not report an unlocked source downgrade as retained at the parent floor', async () => {
    const root = fixture()
    const { migration } = await migrated(root)
    expect(migration.policy.overrides?.some(override => override.rules?.['no-debugger'] === 'off')).toBe(true)
    expect(migration.policyKept.filter(change => change.rule === 'no-debugger')).toEqual([])
  })

  it('replays explicit global options over option-only parent scopes', async () => {
    const root = fixture(
      `export default [{ rules: { 'no-console': ['error', { allow: ['warn'] }] } }]\n`,
      `export default { rules: { 'no-console': 'error' }, overrides: [{ files: ['scripts/**'], options: { 'no-console': [{ allow: ['log'] }] } }] }\n`
    )
    const { engine } = await migrated(root)
    expect(await rule(engine, 'scripts/future.js', 'no-console')).toEqual([2, { allow: ['warn'] }])
    const invalid = await engine.lintText('console.log(1)', { filePath: 'scripts/future.js' })
    expect(invalid.flatMap(item => item.messages).some(message => message.ruleId === 'no-console')).toBe(true)
  })

  it('retains the published shared policy script exception', async () => {
    const root = fixture()
    symlinkSync(join(PACKAGE_ROOT, '../pawl-policy'), join(root, 'node_modules/@santi020k/pawl-policy'))
    const { engine, policy } = await migrated(root, '@santi020k/pawl-policy')
    expect(await rule(engine, 'scripts/future.js', 'no-console')).toEqual([0, {}])
    expect(await rule(engine, 'tests/future.js', 'no-debugger')).toEqual([2])
    expect(policy.lockViolations).toEqual([])
  })

  it('lets explicit source rules replace unlocked parent exceptions in source order', async () => {
    const root = fixture(`export default [
      { files: ['scripts/**/*.js'], rules: { 'no-console': ['error', { allow: ['warn'] }] } },
      { files: ['scripts/quiet/**/*.js'], rules: { 'no-console': ['warn', {}] } }
    ]\n`)
    const { engine } = await migrated(root)
    expect(await rule(engine, 'scripts/future.js', 'no-console')).toEqual([2, { allow: ['warn'] }])
    expect(await rule(engine, 'scripts/quiet/future.js', 'no-console')).toEqual([1, {}])
    const invalid = await engine.lintText('console.log(1)', { filePath: 'scripts/future.js' })
    expect(invalid.flatMap(result => result.messages).some(message => message.ruleId === 'no-console')).toBe(true)
    const valid = await engine.lintText('console.warn(1)', { filePath: 'scripts/future.js' })
    expect(valid.flatMap(result => result.messages).filter(message => message.ruleId === 'no-console')).toEqual([])
  })

  it('refuses ambiguous inherited parent options without changing source, backup or report', async () => {
    const root = fixture(
      `export default [{ files: ['scripts/**/*.js'], rules: { 'no-console': 'warn' } }]\n`,
      `export default { overrides: [{ files: ['scripts/**'], rules: { 'no-console': 'error' }, options: { 'no-console': [{ allow: ['log'] }] } }] }\n`
    )
    const original = readFileSync(join(root, 'eslint.config.js'), 'utf8')
    await expect(planMigrate({ root, extends: './company.js' })).rejects.toThrow(/inherit options/)
    expect(readFileSync(join(root, 'eslint.config.js'), 'utf8')).toBe(original)
    for (const file of ['pawl.config.ts', 'eslint.config.before-pawl.js', MIGRATION_REPORT]) {
      expect(existsSync(join(root, file))).toBe(false)
    }
  })
})
