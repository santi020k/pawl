import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getRule } from '../src/catalog/rules.ts'
import { check } from '../src/check/check.ts'
import { exitCode } from '../src/check/result.ts'
import { BIOME_PRESET } from '../src/engines/biome/config.ts'
import { eslintPlan } from '../src/engines/eslint/plan.ts'
import { checkOxlintConfig, mergeOxlintConfig, oxlintConfig, oxlintCovers } from '../src/engines/oxlint/config.ts'
import { OXLINT_RULES, OXLINT_VERSION, TSGOLINT_VERSION } from '../src/engines/oxlint/rules.ts'
import { runOxlint } from '../src/engines/oxlint/run.ts'
import { defaultPolicy, mergeLayers } from '../src/policy/merge.ts'
import { toolset } from '../src/project/toolset.ts'
import { doctor } from '../src/report/doctor.ts'
import { planInit } from '../src/setup/init.ts'
import { applyPlan } from '../src/setup/plan.ts'
import { link, project, withoutTsgolint, write } from './helpers.ts'

const require = createRequire(import.meta.url)

describe('Oxlint rule list', () => {
  it('was generated from the Oxlint that is installed (run "pnpm run oxlint-rules" if this fails)', () => {
    expect((require('oxlint/package.json') as { version: string }).version).toBe(OXLINT_VERSION)
    expect((require('oxlint-tsgolint/package.json') as { version: string }).version).toBe(TSGOLINT_VERSION)
  })

  it('only names rules of the standard', () => {
    expect(Object.keys(OXLINT_RULES).filter(name => getRule(name)?.name !== name)).toEqual([])
    expect(oxlintCovers('no-debugger')).toBe(true)
    expect(oxlintCovers('pawl/format')).toBe(false)
  })
})

describe('oxlintConfig', () => {
  it('writes the rules Oxlint enforces under its own names, with the plugins they need', () => {
    const config = oxlintConfig(defaultPolicy(), { typescript: true, technologies: ['react'] }) as {
      plugins: string[]
      rules: Record<string, unknown>
    }

    expect(config.rules).toMatchObject({
      'no-debugger': 'error',
      'typescript/no-explicit-any': 'warn',
      'react/rules-of-hooks': 'error',
      'no-unused-vars': ['error', expect.objectContaining({ argsIgnorePattern: '^_' })]
    })
    expect(config.plugins).toEqual([...config.plugins].sort())
    expect(config.plugins).toEqual(expect.arrayContaining(['typescript', 'react', 'unicorn']))
  })

  it('leaves out technologies the project does not use, and follows the policy', () => {
    const policy = mergeLayers([
      { source: 'repo', input: { rules: { 'no-debugger': 'off' }, ignore: ['generated/**'] } }
    ])
    const config = oxlintConfig(policy, { typescript: true, technologies: [] }) as {
      rules: Record<string, unknown>
      ignorePatterns: string[]
    }

    expect(config.rules['no-debugger']).toBe('off')
    expect(config.rules['react/rules-of-hooks']).toBeUndefined()
    expect(config.ignorePatterns).toContain('generated/**')
  })

  it('enforces the jsx-a11y standard in React projects and the promise rules everywhere, natively', () => {
    const react = oxlintConfig(defaultPolicy(), { technologies: ['react'] }) as {
      plugins: string[]
      rules: Record<string, unknown>
    }
    const plain = oxlintConfig(defaultPolicy(), { technologies: [] }) as typeof react

    expect(react.plugins).toEqual(expect.arrayContaining(['jsx-a11y', 'promise']))
    expect(react.rules).toMatchObject({
      'jsx-a11y/alt-text': 'error',
      'jsx-a11y/no-static-element-interactions': ['error', expect.objectContaining({ allowExpressionValues: true })],
      'promise/catch-or-return': 'warn'
    })
    expect(plain.plugins).not.toContain('jsx-a11y')
    expect(plain.rules['promise/always-return']).toBe('warn')
  })
})

describe('Oxlint as the linter, with the real Oxlint', { timeout: 60_000 }, () => {
  it('sets up, lints by neutral rule names, and reports drift', async () => {
    const root = project({
      'package.json': { name: 'fixture', private: true, type: 'module' },
      'src/a.js': 'var count = 1\ndebugger\nif (count == 2) {\n}\nexport { count }\n'
    })

    link(root)

    const plan = await planInit({ root, engine: 'oxlint', install: false, editor: false })

    expect(plan.engines).toEqual(['oxlint'])
    expect(plan.formatter).toBe('biome')
    expect(plan.packages).toEqual(['@santi020k/pawl', '@biomejs/biome', 'oxlint'])
    expect(plan.actions.map(action => action.path)).toEqual([
      'pawl.config.ts',
      'biome.json',
      '.oxlintrc.json',
      'package.json'
    ])
    applyPlan(plan)
    expect(readFileSync(join(root, 'pawl.config.ts'), 'utf8')).toContain("engine: 'oxlint'")
    // Biome is only there to format.
    expect(JSON.parse(readFileSync(join(root, 'biome.json'), 'utf8'))).toEqual({
      extends: [BIOME_PRESET],
      linter: { enabled: false }
    })
    expect(toolset(root, plan.policy)).toEqual({ linter: 'oxlint', formatter: 'biome', biome: true, eslint: false })

    const result = await check({ root, policy: plan.policy, files: ['src/a.js'] })
    const fromOxlint = result.findings.filter(finding => finding.engine === 'oxlint')

    expect(result.setup).toEqual([])
    expect(result.commands).toEqual(['biome check src/a.js', 'oxlint src/a.js'])
    expect(fromOxlint.map(finding => `${finding.line} ${finding.rule}`)).toEqual([
      '1 no-var',
      '2 no-debugger',
      '3 eqeqeq',
      '3 no-empty'
    ])
    expect(fromOxlint[0]).toMatchObject({ file: 'src/a.js', engineRule: 'no-var', severity: 'error' })

    // A policy change is reported until the config is synced.
    const changed = mergeLayers([{ source: 'repo', input: { engine: 'oxlint', rules: { 'no-var': 'off' } } }])

    expect(checkOxlintConfig(root, changed, { typescript: true, technologies: [] }).status).toBe('stale')
    write(root, { '.oxlintrc.json': oxlintConfig(changed, { typescript: true, technologies: [] }) })

    const after = await check({ root, policy: changed, files: ['src/a.js'] })

    expect(after.findings.filter(finding => finding.engine === 'oxlint').map(finding => finding.rule)).toEqual([
      'no-debugger',
      'eqeqeq',
      'no-empty'
    ])
  })

  it('never looks into node_modules, even where no .gitignore lists it', async () => {
    // Plain files and no link to pawl: nothing in this fixture leads outside it.
    const dependency = "var a = 'x'.replace(/x/g, 'y')\ndebugger\nmodule.exports = a\n"
    const root = project({
      'package.json': { name: 'fixture', private: true, type: 'module' },
      'pawl.config.json': { engine: 'oxlint' },
      'src/a.js': 'debugger\n',
      'node_modules/dep/index.js': dependency,
      'packages/ui/node_modules/dep/index.js': dependency
    })

    applyPlan(await planInit({ root, engine: 'oxlint', install: false, editor: false }))

    expect((oxlintConfig(defaultPolicy()) as { ignorePatterns: string[] }).ignorePatterns.slice(0, 3)).toEqual([
      '**/node_modules',
      '**/.git',
      '**/.pawl'
    ])
    expect((await runOxlint({ root })).findings.map(finding => finding.file)).toEqual(['src/a.js'])

    // Oxlint skips node_modules only through a .gitignore. Without this, "fix" rewrote the dependency.
    await check({ root, fix: true })

    expect(readFileSync(join(root, 'node_modules/dep/index.js'), 'utf8')).toBe(dependency)
    expect(readFileSync(join(root, 'packages/ui/node_modules/dep/index.js'), 'utf8')).toBe(dependency)
  })

  it('knows the names a framework gives its component files', async () => {
    const root = project({
      'package.json': {
        name: 'fixture',
        private: true,
        type: 'module',
        dependencies: { vue: '^3.5.0', astro: '^5.0.0', svelte: '^5.0.0' }
      },
      'pawl.config.json': { engine: 'oxlint', rules: { 'no-undef': 'error' } },
      'src/Card.vue': '<script setup>\ndefineProps({ title: String })\nnotDefined()\n</script>\n',
      'src/pages/index.astro': '---\nconst { title } = Astro.props\n---\n<h1>{title}</h1>\n',
      'src/counter.svelte.js': 'export const count = $state(0)\n'
    })

    link(root)
    applyPlan(await planInit({ root, engine: 'oxlint', install: false, editor: false }))

    const undefinedNames = (await runOxlint({ root })).findings
      .filter(finding => finding.rule === 'no-undef')
      .map(finding => `${finding.file} ${finding.message}`)

    // The compiler's own names pass. A name nothing defines is still reported.
    expect(undefinedNames).toEqual(["src/Card.vue 'notDefined' is not defined."])
  })

  it('reports the accessibility and promise rules from the real Oxlint, without their ESLint plugins', async () => {
    const root = project({
      'package.json': { name: 'fixture', private: true, type: 'module' },
      'src/a.jsx':
        'export const A = () => <img src="a.png" />\nexport const load = () => { fetch(\'a\').then(r => { r.json() }) }\n'
    })

    link(root)
    write(root, { '.oxlintrc.json': oxlintConfig(defaultPolicy(), { technologies: ['react'] }) })

    const result = await runOxlint({ root, files: ['src/a.jsx'] })

    expect(result.findings.map(finding => finding.rule)).toEqual(
      expect.arrayContaining(['jsx-a11y/alt-text', 'promise/always-return', 'promise/catch-or-return'])
    )
  })

  it('leaves to Oxlint what it enforces when ESLint runs next to it for the packs', async () => {
    const plan = await eslintPlan({
      root: project({ 'package.json': { name: 'fixture' } }),
      policy: defaultPolicy(),
      biomeActive: false,
      oxlintActive: true,
      typescript: false
    })
    const base = plan.config.find(entry => entry.name === 'pawl/base')?.rules as Record<string, unknown>

    expect(plan.coveredByBiome).toContain('no-debugger')
    expect(base['no-debugger']).toBeUndefined()
    // ESLint is not the linter here, so its own base pack stays off.
    expect(plan.activePacks).toEqual([])
    // A rule of the standard that Oxlint does not have falls to ESLint.
    expect(Object.keys(base).every(name => !oxlintCovers(name))).toBe(true)
  })
})

describe('the rules that need type information', { timeout: 120_000 }, () => {
  const FLOATING = '@typescript-eslint/no-floating-promises'
  /** `declared: false` is a project set up before pawl added oxlint-tsgolint. */
  const fixture = async (tsgolint: boolean, declared = tsgolint): Promise<string> => {
    const root = project({
      'package.json': { name: 'fixture', private: true, type: 'module' },
      'tsconfig.json': {
        compilerOptions: { strict: true, target: 'es2022', module: 'esnext', moduleResolution: 'bundler' }
      },
      'pawl.config.json': { engine: 'oxlint', strict: true },
      'src/a.ts': 'async function load(): Promise<void> {}\n\nload()\n\nexport const a = 1\n'
    })

    link(root, { tsgolint })
    applyPlan(await planInit({ root, engine: 'oxlint', install: false, editor: false }))

    if (!declared) await withoutTsgolint(root)

    return root
  }

  it('are covered only where tsgolint can run them', () => {
    expect(oxlintCovers(FLOATING)).toBe(false)
    expect(oxlintCovers(FLOATING, true)).toBe(true)
    expect(oxlintCovers('pawl/format', true)).toBe(false)
  })

  it("run in the real Oxlint, as findings under the standard's names, when tsgolint is installed", async () => {
    const root = await fixture(true)
    const config = JSON.parse(readFileSync(join(root, '.oxlintrc.json'), 'utf8')) as {
      options?: unknown
      rules: Record<string, unknown>
      overrides?: { files: string[]; rules?: Record<string, unknown> }[]
    }

    expect(config.options).toEqual({ typeAware: true })
    // For TypeScript files only, as in ESLint.
    expect(config.rules['typescript/no-floating-promises']).toBe('off')
    expect(config.overrides).toContainEqual({
      files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'],
      rules: expect.objectContaining({ 'typescript/no-floating-promises': 'error' })
    })

    write(root, { 'src/b.js': 'async function load() {}\n\nload()\n\nexport const b = 1\n' })

    const result = await check({ root, files: ['src/a.ts', 'src/b.js'] })
    const floating = result.findings.filter(finding => finding.rule === FLOATING)

    expect(result.setup.filter(issue => issue.code === 'engine-failed')).toEqual([])
    expect(floating).toEqual([
      expect.objectContaining({
        file: 'src/a.ts',
        line: 3,
        engine: 'oxlint',
        engineRule: 'typescript/no-floating-promises'
      })
    ])

    const report = await doctor(root)

    expect(report.problems).toEqual([])
    expect(report.engines.oxlint?.notEnforced.filter(gap => gap.needs === 'oxlint-tsgolint')).toEqual([])
  })

  it('are left out of the config, and named by doctor, when tsgolint is not installed', async () => {
    const root = await fixture(false)
    const config = JSON.parse(readFileSync(join(root, '.oxlintrc.json'), 'utf8')) as {
      options?: unknown
      rules: Record<string, unknown>
    }

    expect(config.options).toBeUndefined()
    expect(Object.keys(config.rules).filter(rule => rule === 'typescript/no-floating-promises')).toEqual([])

    const result = await check({ root, files: ['src/a.ts'] })

    expect(result.setup.filter(issue => issue.code === 'engine-failed')).toEqual([])
    expect(result.findings.filter(finding => finding.rule === FLOATING)).toEqual([])
    expect((await doctor(root)).problems).toEqual([
      'Not enforced by Oxlint: @typescript-eslint/await-thenable, @typescript-eslint/consistent-type-exports, @typescript-eslint/no-deprecated and 6 more (install oxlint-tsgolint).'
    ])
  })

  it('are asked for by init in a TypeScript project, and not in a JavaScript one', async () => {
    const typescript = project({
      'package.json': { name: 'fixture', private: true, type: 'module' },
      'tsconfig.json': { compilerOptions: { strict: true } }
    })
    const javascript = project({ 'package.json': { name: 'fixture', private: true, type: 'module' } })
    const packages = async (root: string): Promise<readonly string[]> =>
      (await planInit({ root, engine: 'oxlint', install: false, editor: false })).packages

    expect(await packages(typescript)).toContain('oxlint-tsgolint')
    expect(await packages(javascript)).not.toContain('oxlint-tsgolint')
  })

  it('stop the check as a setup problem when tsgolint cannot read the tsconfig', async () => {
    const root = await fixture(true)

    write(root, { 'tsconfig.json': { extends: './missing.json', compilerOptions: { strict: true } } })

    const result = await check({ root, files: ['src/a.ts'] })
    const failed = result.setup.find(issue => issue.code === 'engine-failed')

    expect(failed?.message).toContain(
      'Oxlint could not read tsconfig.json, so the rules that need type information did not run.'
    )
    expect(failed?.message).toContain('missing.json')
    expect(result.findings.map(finding => finding.rule)).not.toContain('oxlint:typescript/tsconfig-error')
    expect(exitCode(result)).toBe(2)
  })

  it('stop the check as a setup problem when tsgolint is declared but not installed', async () => {
    const root = await fixture(false, true)
    const config = JSON.parse(readFileSync(join(root, '.oxlintrc.json'), 'utf8')) as { options?: unknown }
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      devDependencies: Record<string, string>
    }

    // The config follows package.json, so it does not change when the install runs.
    expect(manifest.devDependencies['oxlint-tsgolint']).toBe(TSGOLINT_VERSION)
    expect(config.options).toEqual({ typeAware: true })

    const result = await check({ root, files: ['src/a.ts'] })

    expect(result.setup.map(issue => issue.code)).toEqual(['tsgolint-missing'])
    expect(result.findings).toEqual([])
    expect(exitCode(result)).toBe(2)
  })

  it("make the config stale when tsgolint is added or removed, and sync keeps the project's other options", async () => {
    const root = await fixture(false)
    const policy = defaultPolicy()
    const withTsgolint = { typescript: true, technologies: [], typeAware: true }
    const without = { typescript: true, technologies: [] }

    write(root, { '.oxlintrc.json': oxlintConfig(policy, without) })
    expect(checkOxlintConfig(root, policy, without).status).toBe('ok')
    expect(checkOxlintConfig(root, policy, withTsgolint).status).toBe('stale')

    const merged = mergeOxlintConfig({ options: { typeCheck: true } }, oxlintConfig(policy, withTsgolint))

    expect(merged.options).toEqual({ typeCheck: true, typeAware: true })
    write(root, { '.oxlintrc.json': merged })
    expect(checkOxlintConfig(root, policy, withTsgolint).status).toBe('ok')
    expect(checkOxlintConfig(root, policy, without).status).toBe('stale')
    expect(mergeOxlintConfig(merged, oxlintConfig(policy, without)).options).toEqual({ typeCheck: true })
    expect(mergeOxlintConfig({ options: { typeAware: true } }, oxlintConfig(policy, without)).options).toBeUndefined()
  })

  it('are left to Oxlint, not ESLint, only where tsgolint is installed', async () => {
    const options = {
      root: project({ 'package.json': { name: 'fixture' } }),
      policy: defaultPolicy(),
      biomeActive: false,
      oxlintActive: true,
      typescript: true,
      technologies: []
    }
    const without = await eslintPlan(options)
    const covered = await eslintPlan({ ...options, oxlintTypeAware: true })
    // The fixture has no typescript-eslint, so a rule ESLint would take shows up as one it cannot run.
    const wanted = (plan: typeof without): string[] => plan.notEnforced.map(item => item.rule)

    expect(wanted(without)).toContain('@typescript-eslint/prefer-optional-chain')
    expect(wanted(covered)).not.toContain('@typescript-eslint/prefer-optional-chain')
  })
})
