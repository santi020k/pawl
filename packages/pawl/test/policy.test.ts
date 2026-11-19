import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { eslint } from '../src/engines/eslint.ts'
import {
  DEFAULT_STYLE,
  defaultPolicy,
  effectiveRules,
  findProjectRoot,
  loadPolicy,
  mergeLayers,
  resolvePolicy
} from '../src/policy.ts'
import { project } from './helpers.ts'

describe('mergeLayers', () => {
  it('starts from the default standard', () => {
    const policy = defaultPolicy()

    expect(policy.engine).toBe('auto')
    expect(policy.strict).toBe(false)
    expect(policy.style).toEqual(DEFAULT_STYLE)
    expect(effectiveRules(policy).get('no-debugger')).toBe('error')
  })

  it('lets later layers win', () => {
    const policy = mergeLayers([
      { source: 'company', input: { rules: { 'no-console': 'error' }, style: { quotes: 'double' } } },
      { source: 'repo', input: { rules: { 'no-console': 'off' }, style: { semicolons: true } } }
    ])

    expect(policy.rules['no-console']).toBe('off')
    expect(policy.style).toMatchObject({ quotes: 'double', semicolons: true })
  })

  it('keeps strict on once a layer turns it on', () => {
    const policy = mergeLayers([
      { source: 'company', input: { strict: true } },
      { source: 'repo', input: { strict: false } }
    ])

    expect(policy.strict).toBe(true)
    expect(effectiveRules(policy).get('@typescript-eslint/no-explicit-any')).toBe('error')
  })

  it('refuses to loosen a locked rule and records the attempt', () => {
    const policy = mergeLayers([
      { source: 'company', input: { rules: { 'no-console': 'error' }, locked: ['no-console', 'no-debugger'] } },
      { source: 'repo', input: { rules: { 'no-console': 'warn', 'no-debugger': 'off' } } }
    ])

    expect(policy.rules['no-console']).toBe('error')
    expect(effectiveRules(policy).get('no-debugger')).toBe('error')
    expect(policy.lockViolations).toEqual([
      { rule: 'no-console', wanted: 'warn', kept: 'error', source: 'repo' },
      { rule: 'no-debugger', wanted: 'off', kept: 'error', source: 'repo' }
    ])
  })

  it('allows tightening a locked rule', () => {
    const policy = mergeLayers([
      { source: 'company', input: { rules: { 'no-alert': 'warn' }, locked: ['no-alert'] } },
      { source: 'repo', input: { rules: { 'no-alert': 'error' } } }
    ])

    expect(policy.rules['no-alert']).toBe('error')
    expect(policy.lockViolations).toEqual([])
  })

  it('leaves out rules for technology the project does not use', () => {
    const rules = effectiveRules(defaultPolicy(), { typescript: false, technologies: [] })

    expect(rules.has('react-hooks/rules-of-hooks')).toBe(false)
    expect(rules.has('@typescript-eslint/no-explicit-any')).toBe(false)
    expect(rules.has('no-debugger')).toBe(true)
  })
})

describe('loadPolicy', () => {
  it('returns the default standard without a config file', async () => {
    expect(await loadPolicy(project())).toEqual(defaultPolicy())
  })

  it('follows extends to files and packages, in order', async () => {
    const root = project({
      'pawl.config.mjs':
        "export default { extends: ['@acme/policy', './local.json'], rules: { 'no-console': 'off' }, ignore: ['generated/**'] }\n",
      'local.json': { rules: { 'no-alert': 'error' } },
      // An ESM-only package: resolvable with import but not with require.
      'node_modules/@acme/policy/package.json': {
        name: '@acme/policy',
        type: 'module',
        exports: { '.': { import: './index.js' } }
      },
      'node_modules/@acme/policy/index.js':
        "export default { strict: true, rules: { 'no-console': 'error' }, locked: ['no-debugger'] }\n"
    })
    const policy = await loadPolicy(root)

    expect(policy.strict).toBe(true)
    expect(policy.rules).toEqual({ 'no-console': 'off', 'no-alert': 'error' })
    expect(policy.locked).toEqual(['no-debugger'])
    expect(policy.ignore).toEqual(['generated/**'])
    expect(policy.sources).toEqual(['pawl defaults', '@acme/policy', './local.json', 'pawl.config.mjs'])
  })

  it('explains a missing policy package', async () => {
    const root = project({ 'pawl.config.json': { extends: '@acme/missing' } })

    await expect(loadPolicy(root)).rejects.toThrow(/Cannot find "@acme\/missing"/)
  })

  it('rejects a config without a default export', async () => {
    const root = project({ 'pawl.config.mjs': 'export const policy = {}\n' })

    await expect(loadPolicy(root)).rejects.toThrow(join(root, 'pawl.config.mjs'))
  })

  it('reads a JSON policy with a $schema line for editors', async () => {
    const root = project({
      'pawl.config.json': {
        $schema: './node_modules/@santi020k/pawl/pawl.config.schema.json',
        rules: { 'no-console': 'off' }
      }
    })

    expect((await loadPolicy(root)).rules).toEqual({ 'no-console': 'off' })
  })

  it('refuses an option it does not know, in any layer, so a typo does not pass in silence', async () => {
    const root = project({ 'pawl.config.json': { ignores: ['dist'] } })

    await expect(loadPolicy(root)).rejects.toThrow(/an option pawl does not know: ignores\. The options are: extends/)
    await expect(resolvePolicy({ extends: [{ rule: {} } as never] }, join(root, 'x.ts'))).rejects.toThrow(
      /does not know: rule/
    )
  })
})

describe('the newer policy options', () => {
  it('start from on for the ignores and detection, with no warning limit or runtime', () => {
    expect(defaultPolicy()).toMatchObject({
      gitignore: true,
      defaultIgnores: true,
      runtime: undefined,
      detect: { enabled: true, exclude: [] },
      maxWarnings: undefined,
      overrides: []
    })
  })

  it('let a later layer lower the warning limit but not raise it', () => {
    const policy = mergeLayers([
      { source: 'company', input: { maxWarnings: 5 } },
      { source: 'repo', input: { maxWarnings: 20 } },
      { source: 'team', input: { maxWarnings: 2 } }
    ])

    expect(policy.maxWarnings).toBe(2)
  })

  it('let a later layer set the ignores, the runtime and detection, and add up the exclusions', () => {
    const policy = mergeLayers([
      { source: 'company', input: { gitignore: false, runtime: 'node', detect: { exclude: ['tailwind'] } } },
      {
        source: 'repo',
        input: { defaultIgnores: false, runtime: ['node', 'bun', 'node'], detect: { exclude: ['turbo'] } }
      }
    ])

    expect(policy).toMatchObject({
      gitignore: false,
      defaultIgnores: false,
      runtime: ['node', 'bun'],
      detect: { enabled: true, exclude: ['tailwind', 'turbo'] }
    })
    expect(mergeLayers([{ source: 'repo', input: { detect: false } }]).detect.enabled).toBe(false)
  })
})

describe('the project root', () => {
  it('is the nearest folder with a pawl config, then with an ESLint config, then with a package.json', () => {
    const root = project({
      'pawl.config.json': {},
      'package.json': { name: 'repo' },
      'packages/app/package.json': { name: 'app' }
    })

    mkdirSync(join(root, 'packages/app/src'), { recursive: true })
    expect(findProjectRoot(join(root, 'packages/app/src'))).toBe(root)

    const plain = project({ 'eslint.config.js': '', 'apps/web/package.json': { name: 'web' } })

    expect(findProjectRoot(join(plain, 'apps/web'))).toBe(plain)

    const bare = project({ 'lib/package.json': { name: 'lib' } })

    mkdirSync(join(bare, 'lib/src'), { recursive: true })
    expect(findProjectRoot(join(bare, 'lib/src'))).toBe(join(bare, 'lib'))
  })

  it('does not depend on where ESLint is started when eslint() is given the config folder', async () => {
    const root = project({ 'package.json': { name: 'repo' }, 'pawl.config.json': { ignore: ['vendor'] } })
    const elsewhere = project({ 'package.json': { name: 'other' } })
    const from = process.cwd()

    try {
      process.chdir(elsewhere)

      const config = await eslint({ root })

      expect(config[0]?.ignores).toEqual(expect.arrayContaining(['**/vendor']))
      expect((await eslint())[0]?.ignores).not.toEqual(expect.arrayContaining(['**/vendor']))
    } finally {
      process.chdir(from)
    }
  })
})
