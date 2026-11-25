import { describe, expect, it } from 'vitest'
import { check } from '../src/check/check.ts'
import { exitCode } from '../src/check/result.ts'
import { readReport } from '../src/engines/engine.ts'
import { eslintPlan } from '../src/engines/eslint/plan.ts'
import { defaultPolicy, mergeLayers } from '../src/policy/merge.ts'
import { link, project } from './helpers.ts'

const block = (config: Record<string, unknown>[], name: string): Record<string, unknown> | undefined =>
  config.find(entry => entry.name === name)

const manifest = (name: string): object => ({ name, type: 'module', exports: './index.js' })

/** A project with stand-ins for typescript-eslint and one plugin, so the wiring can be tested offline. */
const withPlugins = (): string =>
  project({
    'package.json': { name: 'fixture' },
    'node_modules/typescript-eslint/package.json': manifest('typescript-eslint'),
    'node_modules/typescript-eslint/index.js':
      "export default { parser: { name: 'ts-parser' }, plugin: { rules: {} } }\n",
    'node_modules/eslint-plugin-react-hooks/package.json': manifest('eslint-plugin-react-hooks'),
    'node_modules/eslint-plugin-react-hooks/index.js': 'export default { rules: {} }\n'
  })

describe('eslintPlan', () => {
  it('leaves a rule named for another engine to that engine', async () => {
    const policy = mergeLayers([
      { input: { rules: { 'oxlint:no-foo': 'error', 'biome:style/useBlockStatements': 'error' } }, source: 'test' }
    ])
    const plan = await eslintPlan({ root: withPlugins(), policy, biomeActive: false, typescript: false })
    const base = block(plan.config, 'pawl/base') as { rules: Record<string, unknown> }

    expect(Object.keys(base.rules).filter(name => name.includes(':'))).toEqual([])
    expect(plan.notEnforced.filter(({ rule, needs }) => `${rule} ${needs}`.includes(':'))).toEqual([])
  })

  it('takes every rule when ESLint is the only engine', async () => {
    const plan = await eslintPlan({
      root: withPlugins(),
      policy: defaultPolicy(),
      biomeActive: false,
      typescript: true,
      technologies: ['react']
    })
    const base = block(plan.config, 'pawl/base') as { rules: Record<string, unknown>; plugins: Record<string, unknown> }
    const typescript = block(plan.config, 'pawl/typescript') as {
      rules: Record<string, unknown>
      plugins: Record<string, unknown>
      languageOptions: { parser: unknown; parserOptions: Record<string, unknown> }
    }

    expect(base.rules).toMatchObject({
      'no-debugger': 'error',
      'no-console': 'warn',
      eqeqeq: 'error',
      'react-hooks/rules-of-hooks': 'error'
    })
    expect(base.rules['no-shadow']).toBeUndefined()
    expect(Object.keys(base.plugins)).toEqual(['react-hooks'])
    expect(typescript.rules['@typescript-eslint/no-explicit-any']).toBe('warn')
    expect(typescript.languageOptions.parser).toEqual({ name: 'ts-parser' })
    expect(Object.keys(typescript.plugins)).toEqual(['@typescript-eslint'])
    // prefer-optional-chain is on and needs type information.
    expect(typescript.languageOptions.parserOptions).toMatchObject({ projectService: true })
    expect(plan.coveredByBiome).toEqual([])
    // In TypeScript files the typescript-eslint twin replaces the core rule, with the same options.
    expect(base.rules['no-unused-vars']).toEqual(['error', expect.objectContaining({ argsIgnorePattern: '^_' })])
    expect(typescript.rules['no-unused-vars']).toBe('off')
    expect(typescript.rules['@typescript-eslint/no-unused-vars']).toEqual(base.rules['no-unused-vars'])
    expect(plan.notEnforced).toContainEqual({
      rule: 'unused-imports/no-unused-imports',
      needs: 'eslint-plugin-unused-imports'
    })
    expect(plan.notEnforced).toContainEqual({ rule: 'vitest/no-disabled-tests', needs: '@vitest/eslint-plugin' })
  })

  it('leaves to Biome every rule Biome covers', async () => {
    const policy = mergeLayers([
      { source: 'repo', input: { rules: { 'no-restricted-syntax': 'error', 'vue/no-v-html': 'error' } } }
    ])
    const plan = await eslintPlan({
      root: withPlugins(),
      policy,
      biomeActive: true,
      typescript: true,
      technologies: ['react']
    })

    expect(block(plan.config, 'pawl/base')?.rules).toEqual({ 'no-restricted-syntax': 'error' })
    // TypeScript files still need the parser, even with every TypeScript rule left to Biome.
    expect(block(plan.config, 'pawl/typescript')).toMatchObject({ rules: {}, languageOptions: { parserOptions: {} } })
    expect(plan.coveredByBiome).toContain('no-debugger')
    expect(plan.coveredByBiome).toContain('react-hooks/rules-of-hooks')
    expect(plan.notEnforced).toEqual([{ rule: 'vue/no-v-html', needs: 'eslint-plugin-vue', required: true }])
  })

  it('next to Biome, asks for no plugin for a rule Biome lacks unless the policy names it', async () => {
    const quiet = await eslintPlan({
      root: withPlugins(),
      policy: defaultPolicy(),
      biomeActive: true,
      typescript: false
    })

    expect(quiet.notEnforced).toEqual([])
    expect(JSON.stringify(quiet.config)).not.toContain('unicorn/prefer-spread')

    const named = await eslintPlan({
      root: withPlugins(),
      policy: mergeLayers([{ source: 'repo', input: { rules: { 'unicorn/prefer-spread': 'error' } } }]),
      biomeActive: true,
      typescript: false
    })

    expect(named.notEnforced).toEqual([
      { rule: 'unicorn/prefer-spread', needs: 'eslint-plugin-unicorn', required: true }
    ])
  })

  it('leaves to Oxlint the rules Oxlint enforces and Biome does not', async () => {
    const plan = await eslintPlan({
      root: withPlugins(),
      policy: defaultPolicy(),
      biomeActive: false,
      oxlintActive: true,
      typescript: false
    })

    expect(plan.coveredByBiome).toEqual(expect.arrayContaining(['unicorn/prefer-spread', 'promise/always-return']))
    expect(plan.notEnforced.map(item => item.rule)).not.toContain('unicorn/prefer-spread')
  })

  it('skips TypeScript and React rules for projects without them', async () => {
    const plan = await eslintPlan({
      root: withPlugins(),
      policy: defaultPolicy(),
      biomeActive: false,
      typescript: false,
      technologies: []
    })

    expect(block(plan.config, 'pawl/typescript')).toBeUndefined()
    expect(JSON.stringify(plan.config)).not.toContain('react-hooks')
  })

  it('leaves the rules Biome enforces off where the javascript and typescript presets turn them on', async () => {
    // `migrate` names both packs, and Biome stays the linter: ESLint would report each finding again,
    // at the preset's level instead of the policy's.
    const root = project({
      'package.json': { name: 'fixture' },
      'node_modules/typescript-eslint/package.json': manifest('typescript-eslint'),
      'node_modules/typescript-eslint/index.js': [
        "const rules = { '@typescript-eslint/no-non-null-assertion': 'error', '@typescript-eslint/no-unused-vars': 'error' }",
        "export default { parser: { name: 'ts-parser' }, plugin: { rules: {} }, configs: { strictTypeChecked: [{ rules }], stylisticTypeChecked: [] } }"
      ].join('\n'),
      'node_modules/@eslint/js/package.json': manifest('@eslint/js'),
      'node_modules/@eslint/js/index.js':
        "export default { configs: { recommended: { rules: { 'no-debugger': 'error', 'no-unused-vars': 'error' } } } }\n"
    })
    const policy = mergeLayers([
      {
        source: 'repo',
        input: { packs: ['javascript', 'typescript'], rules: { '@typescript-eslint/no-non-null-assertion': 'off' } }
      }
    ])
    const plan = await eslintPlan({ root, policy, biomeActive: true, typescript: true, technologies: [] })
    const on = (name: string): string[] =>
      Object.entries(block(plan.config, name)?.rules ?? {}).flatMap(([rule, value]) =>
        (Array.isArray(value) ? value[0] : value) === 'off' ? [] : [rule]
      )

    expect(on('pawl/base')).not.toContain('no-debugger')
    expect(on('pawl/base')).not.toContain('no-unused-vars')
    expect(on('pawl/typescript')).not.toContain('@typescript-eslint/no-non-null-assertion')
    expect(on('pawl/typescript')).not.toContain('@typescript-eslint/no-unused-vars')
  })

  it('says why when a plugin is installed but cannot load', async () => {
    const root = project({
      'package.json': { name: 'fixture' },
      'node_modules/typescript-eslint/package.json': manifest('typescript-eslint'),
      'node_modules/typescript-eslint/index.js': "throw new Error('typescript-eslint does not support TS 7.0.')\n"
    })
    const plan = await eslintPlan({
      root,
      policy: defaultPolicy(),
      biomeActive: true,
      typescript: true,
      technologies: []
    })

    expect(block(plan.config, 'pawl/typescript')).toBeUndefined()
    expect(plan.notEnforced).toEqual([
      {
        rule: 'TypeScript files',
        needs: 'typescript-eslint, which is installed but failed to load: typescript-eslint does not support TS 7.0.'
      }
    ])
  })

  it('ignores build output and the policy ignore list', async () => {
    const policy = mergeLayers([{ source: 'repo', input: { ignore: ['generated/**', 'vendor'] } }])
    const plan = await eslintPlan({ root: project(), policy, biomeActive: true, typescript: false, technologies: [] })
    const ignores = block(plan.config, 'pawl/ignores')?.ignores as string[]

    expect(ignores).toEqual(
      expect.arrayContaining([
        '**/dist',
        '**/dist/**',
        '**/node_modules/**',
        'generated/**',
        '**/vendor',
        '**/vendor/**'
      ])
    )
  })

  describe('packs', () => {
    const plugin = (name: string, body: string): Record<string, string | object> => ({
      [`node_modules/${name}/package.json`]: manifest(name),
      [`node_modules/${name}/index.js`]: `export default ${body}\n`
    })
    const zod = plugin(
      'eslint-plugin-zod',
      "{ configs: { recommended: { rules: { 'zod/from-the-preset': 'warn', 'zod/no-any': 'error' } } } }"
    )
    const options = { policy: defaultPolicy(), biomeActive: true, typescript: false }

    it('switches a pack on when the project depends on what it is for and has the plugin', async () => {
      const root = project({ 'package.json': { name: 'fixture' }, ...zod })
      const policy = mergeLayers([{ source: 'repo', input: { rules: { 'zod/no-any': 'off' } } }])
      const plan = await eslintPlan({ ...options, root, policy, dependencies: ['zod'] })
      const block = plan.config.find(entry => entry.name === 'pawl/pack/zod') as {
        plugins: object
        rules: Record<string, string>
      }

      expect(plan.activePacks).toEqual(['zod'])
      expect(Object.keys(block.plugins)).toEqual(['zod'])
      // The plugin's preset, then the levels the standard sets, then the project's own policy.
      expect(block.rules).toMatchObject({ 'zod/from-the-preset': 'warn', 'zod/no-any': 'off' })
      expect(Object.keys(block.rules).length).toBeGreaterThan(2)
      expect(plan.notEnforced).toEqual([])
    })

    it('only suggests a pack whose plugin is missing, and stays quiet about packs nobody asked for', async () => {
      const plan = await eslintPlan({
        ...options,
        root: project({ 'package.json': { name: 'fixture' } }),
        dependencies: ['zod']
      })

      expect(plan.activePacks).toEqual([])
      expect(plan.availablePacks).toEqual(['zod'])
      expect(plan.notEnforced).toEqual([])
      expect(plan.config.map(entry => entry.name)).toEqual(['pawl/ignores', 'pawl/base'])
    })

    it('reports a pack the policy names when its plugin is not installed', async () => {
      const policy = mergeLayers([{ source: 'repo', input: { packs: ['unicorn'] } }])
      const plan = await eslintPlan({ ...options, root: project({ 'package.json': { name: 'fixture' } }), policy })

      expect(plan.notEnforced).toEqual([{ rule: 'The Unicorn pack', needs: 'eslint-plugin-unicorn', required: true }])
    })

    it('takes the jsx-a11y catalog rules only with their pack when ESLint lints alone', async () => {
      const root = project({ 'package.json': { name: 'fixture' } })
      const eslintOnly = { ...options, root, biomeActive: false, technologies: ['react' as const] }
      const quiet = await eslintPlan(eslintOnly)

      expect(quiet.notEnforced.filter(item => item.rule.startsWith('jsx-a11y/'))).toEqual([])

      // A rule the policy names itself is still reported when ESLint cannot run it.
      const named = mergeLayers([{ source: 'repo', input: { rules: { 'jsx-a11y/alt-text': 'error' } } }])
      const loud = await eslintPlan({ ...eslintOnly, policy: named })

      expect(loud.notEnforced.filter(item => item.rule.startsWith('jsx-a11y/'))).toEqual([
        { rule: 'jsx-a11y/alt-text', needs: 'eslint-plugin-jsx-a11y', required: true }
      ])
    })

    it('gives the active jsx-a11y pack the catalog levels and options of its rules', async () => {
      const a11y = plugin(
        'eslint-plugin-jsx-a11y',
        "{ rules: { 'alt-text': { create() { return {} } }, 'no-static-element-interactions': { create() { return {} } }, 'anchor-ambiguous-text': { create() { return {} } } }, flatConfigs: { recommended: { rules: { 'jsx-a11y/alt-text': 'warn', 'jsx-a11y/anchor-ambiguous-text': 'warn' } } } }"
      )
      const policy = mergeLayers([{ source: 'repo', input: { packs: ['jsx-a11y'] } }])
      const plan = await eslintPlan({
        ...options,
        root: project({ 'package.json': { name: 'fixture' }, ...a11y }),
        policy,
        biomeActive: false,
        technologies: ['react']
      })
      const block = plan.config.find(entry => entry.name === 'pawl/pack/jsx-a11y') as { rules: Record<string, unknown> }

      expect(block.rules).toMatchObject({
        'jsx-a11y/alt-text': 'error',
        'jsx-a11y/anchor-ambiguous-text': 'warn',
        'jsx-a11y/no-static-element-interactions': ['error', expect.objectContaining({ allowExpressionValues: true })]
      })
    })

    it("uses a plugin's own flat config whole when it brings a parser, and adds levels after it", async () => {
      const vue = plugin(
        'eslint-plugin-vue',
        "{ rules: {}, configs: { 'flat/recommended': [{ name: 'vue/base', files: ['**/*.vue'] }, { name: 'vue/rules', rules: { 'vue/no-v-html': 'warn' } }] } }"
      )
      const plan = await eslintPlan({
        ...options,
        root: project({ 'package.json': { name: 'fixture' }, ...vue }),
        dependencies: ['vue']
      })

      expect(plan.config.map(entry => entry.name)).toEqual([
        'pawl/ignores',
        'pawl/base',
        'vue/base',
        'vue/rules',
        'pawl/pack/vue'
      ])
      expect(plan.config.at(-1)).toMatchObject({ files: ['**/*.vue'], plugins: { vue: expect.any(Object) } })
    })

    it('starts the TypeScript pack from the strict and stylistic type-checked presets, then sets its levels', async () => {
      const tseslint = plugin(
        'typescript-eslint',
        `{
          parser: { name: 'ts-parser' },
          plugin: { rules: {} },
          configs: {
            strictTypeChecked: [
              { rules: { '@typescript-eslint/no-floating-promises': 'error', '@typescript-eslint/no-unnecessary-condition': 'error' } },
              { rules: { '@typescript-eslint/no-unsafe-return': 'error', '@typescript-eslint/prefer-nullish-coalescing': 'error' } }
            ],
            stylisticTypeChecked: [
              { rules: { '@typescript-eslint/consistent-type-definitions': 'error', '@typescript-eslint/prefer-nullish-coalescing': 'error' } }
            ]
          }
        }`
      )
      const root = project({ 'package.json': { name: 'fixture' }, ...tseslint })
      const plan = await eslintPlan({ ...options, root, biomeActive: false, typescript: true })
      const typescript = block(plan.config, 'pawl/typescript') as {
        rules: Record<string, unknown>
        languageOptions: { parserOptions: Record<string, unknown> }
      }

      expect(plan.activePacks).toContain('typescript')
      expect(typescript.rules).toMatchObject({
        // From the first preset and from the one laid over it.
        '@typescript-eslint/no-floating-promises': 'error',
        '@typescript-eslint/consistent-type-definitions': 'error',
        // The standard's own levels come last.
        '@typescript-eslint/no-unnecessary-condition': 'off',
        '@typescript-eslint/prefer-nullish-coalescing': 'warn'
      })
      expect(typescript.languageOptions.parserOptions).toMatchObject({ projectService: true })
    })

    it('gives ESLint its own base rules when it is the linter, and leaves Biome its rules when it is not', async () => {
      const base = plugin(
        '@eslint/js',
        "{ configs: { recommended: { rules: { 'no-debugger': 'error', 'no-dupe-args': 'error' } } } }"
      )
      const vitest = plugin(
        '@vitest/eslint-plugin',
        "{ rules: {}, configs: { recommended: { rules: { 'vitest/no-focused-tests': 'error', 'vitest/valid-title': 'error' } } } }"
      )
      const root = project({ 'package.json': { name: 'fixture' }, ...base, ...vitest })
      const asLinter = await eslintPlan({ ...options, root, biomeActive: false, dependencies: ['vitest'] })
      const nextToBiome = await eslintPlan({ ...options, root, biomeActive: true, dependencies: ['vitest'] })
      const rules = (plan: typeof asLinter, name: string) =>
        plan.config.find(entry => entry.name === name)?.rules as Record<string, unknown>

      expect(asLinter.activePacks).toEqual(['javascript', 'vitest'])
      expect(rules(asLinter, 'pawl/base')).toMatchObject({ 'no-dupe-args': 'error', 'no-debugger': 'error' })
      expect(nextToBiome.activePacks).toEqual(['vitest'])
      // Biome already reports focused tests, so ESLint does not report them a second time.
      expect(rules(nextToBiome, 'pawl/pack/vitest')).toMatchObject({
        'vitest/no-focused-tests': 'off',
        'vitest/valid-title': 'error'
      })
    })
  })
})

describe('an engine report', () => {
  it('is read from the first bracket, or from the first line after the noise that starts with one', () => {
    expect(readReport('{"diagnostics":[]}', '{')).toEqual({ diagnostics: [] })
    expect(readReport('warning: slow\n{"diagnostics":[]}\n', '{')).toEqual({ diagnostics: [] })
    expect(readReport('[plugin] ready\n[{"filePath":"a.js","messages":[]}]', '[')).toEqual([
      { filePath: 'a.js', messages: [] }
    ])
  })

  it("is found after noise with a bracket, when the report puts each finding on a line of its own, as Oxlint's does", () => {
    const report = '{ "diagnostics": [{"code": "a"},\n{"code": "b"},\n{"code": "c"}],\n  "number_of_files": 1\n}\n'

    expect(readReport<{ diagnostics: unknown[] }>(`{config} loaded\n${report}`, '{')?.diagnostics).toHaveLength(3)
    expect(readReport<{ diagnostics: unknown[] }>(`a {\n{ not json\n${report}`, '{')?.diagnostics).toHaveLength(3)
  })

  it('is undefined when the output holds none', () => {
    expect(readReport('', '{')).toBeUndefined()
    expect(readReport('Segmentation fault', '[')).toBeUndefined()
    expect(readReport('{ "diagnostics": [', '{')).toBeUndefined()
  })
})

describe('the report of the real ESLint', { timeout: 60_000 }, () => {
  const fixture = (config: string): string => {
    const root = project({
      'package.json': { name: 'fixture', private: true, type: 'module' },
      'pawl.config.json': { engine: 'eslint', formatter: 'prettier' },
      '.prettierrc.json': '{}\n',
      'eslint.config.js': config,
      'src/a.js': 'debugger\n'
    })

    link(root, { eslint: true, prettier: true })

    return root
  }

  it('is read when a config file prints lines of its own before it', async () => {
    const result = await check({
      root: fixture("console.log('[my-plugin] ready {')\n\nexport default [{ rules: { 'no-debugger': 'error' } }]\n")
    })

    expect(result.setup.filter(issue => issue.code === 'engine-failed')).toEqual([])
    expect(
      result.findings.filter(finding => finding.engine === 'eslint').map(finding => `${finding.file} ${finding.rule}`)
    ).toEqual(['src/a.js no-debugger'])
  })

  it('is a setup problem, with what ESLint said, when the config file fails', async () => {
    const result = await check({ root: fixture("throw new Error('the config is broken')\n") })

    const failed = result.setup.filter(issue => issue.code === 'engine-failed')

    expect(failed).toHaveLength(1)
    expect(failed[0]?.message).toContain('eslint could not run:')
    expect(failed[0]?.message).toContain('the config is broken')
    expect(exitCode(result)).toBe(2)
  })
})
