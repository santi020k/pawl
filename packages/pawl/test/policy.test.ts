import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { eslint } from '../src/engines/eslint/plan.ts'
import { effectiveRules } from '../src/policy/levels.ts'
import { findProjectRoot, loadPolicy, resolvePolicy } from '../src/policy/load.ts'
import { DEFAULT_STYLE, defaultPolicy, mergeLayers } from '../src/policy/merge.ts'
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

describe('the values of a policy', () => {
  const refused = async (policy: object): Promise<string> => {
    const root = project({ 'pawl.config.json': policy })

    // The message names the file by its full path.
    return loadPolicy(root).then(
      () => 'accepted',
      (error: Error) => error.message.replace(`${root}/`, '')
    )
  }
  const one = (problem: string): string => `pawl.config.json has a value pawl cannot use: ${problem}`

  it('are refused when pawl cannot use them, with the place and what it takes', async () => {
    expect(await refused({ rules: { 'no-console': 'warning' } })).toBe(
      one('"rules.no-console" is "warning". It must be "off", "warn" or "error".')
    )
    expect(await refused({ engine: 'rome' })).toBe(
      one('"engine" is "rome". It must be "auto", "biome", "oxlint" or "eslint".')
    )
    expect(await refused({ strict: 'false' })).toBe(one('"strict" is "false". It must be true or false.'))
    expect(await refused({ packs: 'unicorn' })).toBe(one('"packs" is "unicorn". It must be a list of strings.'))
    expect(await refused({ ignore: ['dist', 3] })).toBe(one('"ignore[1]" is 3. It must be a string.'))
    expect(await refused({ maxWarnings: -1 })).toBe(one('"maxWarnings" is -1. It must be a whole number, 0 or more.'))
    expect(await refused({ maxWarnings: '0' })).toBe(one('"maxWarnings" is "0". It must be a whole number, 0 or more.'))
    expect(await refused({ style: { indent: 3 } })).toBe(one('"style.indent" is 3. It must be 2, 4 or "tab".'))
    expect(await refused({ style: { lineWidth: 400 } })).toBe(
      one('"style.lineWidth" is 400. It must be a whole number from 1 to 320.')
    )
    expect(await refused({ options: { 'no-console': { allow: ['warn'] } } })).toBe(
      one('"options.no-console" is an object. It must be a list.')
    )
  })

  it('are checked inside overrides, runtimes and detection too', async () => {
    expect(await refused({ overrides: [{ rules: { 'no-console': 'off' } }] })).toBe(
      one('"overrides[0]" has no "files".')
    )
    expect(await refused({ overrides: [{ files: '*.test.ts', rules: { 'no-console': 'off' } }] })).toBe(
      one('"overrides[0].files" is "*.test.ts". It must be a list of strings.')
    )
    expect(await refused({ runtime: ['node', 'nodejs'] })).toBe(
      one('"runtime[1]" is "nodejs". It must be "node", "browser", "bun", "deno" or "worker".')
    )
    expect(await refused({ runtime: 'edge' })).toContain('"runtime" is "edge". It must be "node", "browser"')
    expect(await refused({ detect: { exclude: ['ember'] } })).toContain('"detect.exclude[0]" is "ember".')
    expect(await refused({ style: { indentation: 2 } })).toBe(
      one(
        '"style.indentation" is not an option. The options there are: indent, lineWidth, quotes, semicolons, trailingCommas, arrowParens.'
      )
    )
  })

  it('are listed together when several are wrong', async () => {
    expect(await refused({ strict: 1, rules: { eqeqeq: 'always' } })).toBe(
      [
        'pawl.config.json has values pawl cannot use:',
        '  "strict" is 1. It must be true or false.',
        '  "rules.eqeqeq" is "always". It must be "off", "warn" or "error".'
      ].join('\n')
    )
  })

  it('include the names of packs, where a typo would switch nothing on', async () => {
    expect(await refused({ packs: ['unicorn', 'unicorns', 'de-morgan', 'unicorn/recommended'] })).toMatch(
      /^pawl\.config\.json has a value pawl cannot use: "packs" names "unicorns", which is not a pack\. The packs are: javascript, /
    )
    expect(await refused({ packs: ['unicorn', 'de-morgan', 'unicorn/recommended'] })).toBe('accepted')
    // The guards a policy switches on by name are in the list too.
    expect(await refused({ packs: ['de-morgen'] })).toMatch(/, de-morgan\.$/)
  })

  it('read braces in a pattern as a glob does, so every engine gets the same patterns', () => {
    const policy = mergeLayers([
      {
        source: 'repo',
        input: {
          ignore: ['tools/*.{gen,auto}.js', 'src/app/[slug]', 'notes\\{1\\}.md'],
          overrides: [{ files: ['**/*.{test,spec}.ts'], rules: { 'no-console': 'off' } }]
        }
      }
    ])

    expect(policy.ignore).toEqual(['tools/*.gen.js', 'tools/*.auto.js', 'src/app/\\[slug\\]', 'notes\\{1\\}.md'])
    expect(policy.overrides[0]?.files).toEqual(['**/*.test.ts', '**/*.spec.ts'])
  })

  it('count an option set to undefined in a JS policy as not set, as the merge does', async () => {
    const root = project({
      'pawl.config.mjs': [
        'const ci = false',
        'export default {',
        '  maxWarnings: ci ? 0 : undefined,',
        '  runtime: undefined,',
        '  extends: undefined,',
        '  style: { quotes: undefined, indent: 4 },',
        "  overrides: [{ files: ['*.test.ts'], rules: { 'no-console': undefined } }],",
        "  rules: { 'no-var': undefined, eqeqeq: 'warn' }",
        '}',
        ''
      ].join('\n')
    })
    const policy = await loadPolicy(root)

    expect(policy.maxWarnings).toBeUndefined()
    expect(policy.runtime).toBeUndefined()
    expect(policy.style.indent).toBe(4)
    expect(policy.style.quotes).toBe(defaultPolicy().style.quotes)
    expect(policy.rules.eqeqeq).toBe('warn')
    expect(policy.rules['no-var']).toBe(defaultPolicy().rules['no-var'])
    // A value that is there still has to be right, and an override still needs its files.
    expect(await refused({ overrides: [{ files: null }] })).toContain('"overrides[0].files" is null.')
  })

  it('are checked in every layer, and left alone when they are right', async () => {
    const root = project({ 'pawl.config.json': { extends: './base.json' }, 'base.json': { formatter: 'dprint' } })

    await expect(loadPolicy(root)).rejects.toThrow(/base\.json has a value pawl cannot use: "formatter" is "dprint"/)
    await expect(resolvePolicy({ extends: [{ rules: { 'no-var': 2 } } as never] }, join(root, 'x.ts'))).rejects.toThrow(
      'inline policy (inline) has a value pawl cannot use: "rules.no-var" is 2.'
    )
    expect(
      await refused({
        $schema: './schema.json',
        extends: [{ rules: { 'no-var': 'warn' } }],
        engine: 'auto',
        formatter: 'prettier',
        packs: ['unicorn'],
        strict: true,
        maxWarnings: 0,
        style: { indent: 'tab', lineWidth: 100 },
        rules: { 'no-console': 'off', 'biome:style/noDefaultExport': 'error' },
        options: { 'no-console': [{ allow: ['warn'] }] },
        biomeOptions: { 'no-unused-vars': { ignoreRestSiblings: false } },
        overrides: [{ files: ['*.test.ts'], rules: { 'no-console': 'off' } }],
        locked: ['no-debugger'],
        ignore: ['vendor'],
        gitignore: false,
        defaultIgnores: true,
        runtime: ['node', 'bun'],
        detect: { exclude: ['tailwind', 'turbo'] }
      })
    ).toBe('accepted')
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
