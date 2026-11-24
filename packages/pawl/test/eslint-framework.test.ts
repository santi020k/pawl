import { spawnSync } from 'node:child_process'
import { mkdirSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'
import { eslintPlan, mergeLayers } from '../src/index.ts'
import {
  astro,
  createTypeScriptImportResolver,
  importPlugin,
  pluginRoot,
  typescript
} from './fixtures/eslint/plugins.ts'
import { project, write } from './helpers.ts'

const rootFixture = (): string =>
  project({
    'package.json': { name: 'framework-fixture', type: 'module' },
    'tsconfig.json': {
      compilerOptions: { allowJs: true, strict: true, paths: { '@local/*': ['./src/*'] } },
      include: ['src/**/*.ts', 'scripts/**/*.ts']
    },
    'src/value.ts': 'export const value = 1;\n',
    'src/index.ts': 'debugger; const value: any = 1; console.log(value);\n',
    'scripts/tool.ts': 'debugger;\n',
    'src/page.astro':
      '---\ndebugger; const value: any = 1;\n---\n<p>{value}</p>\n<script lang="ts">debugger;</script>\n'
  })

const frameworkPlan = (root: string) =>
  eslintPlan({
    root,
    policy: mergeLayers([
      {
        source: 'company',
        input: {
          rules: { 'no-debugger': 'error', '@typescript-eslint/no-explicit-any': 'error' },
          locked: ['no-debugger', '@typescript-eslint/no-explicit-any']
        }
      }
    ]),
    biomeActive: false,
    typescript: true,
    technologies: ['astro'],
    pluginRoots: [pluginRoot],
    baseConfig: [
      ...astro.configs['flat/recommended'],
      { files: ['**/*.astro'], languageOptions: { parserOptions: { parser: typescript.parser } } },
      { files: ['**/*.{ts,js,astro}'], rules: { 'no-debugger': 'off', '@typescript-eslint/no-explicit-any': 'off' } }
    ]
  })

describe('framework ESLint integration', () => {
  it('keeps locked floors and the real Astro parser after local exceptions', async () => {
    const root = rootFixture()
    const plan = await frameworkPlan(root)
    const runner = new ESLint({ cwd: root, overrideConfigFile: true, overrideConfig: plan.config })
    for (const file of ['src/index.ts', 'scripts/tool.ts', 'src/page.astro']) {
      const config: unknown = await runner.calculateConfigForFile(join(root, file))
      expect(config).toMatchObject({ rules: { 'no-debugger': [2] } })
      const reports = await runner.lintFiles([file])
      expect(
        reports.flatMap(report => report.messages).some(message => message.ruleId === 'no-debugger'),
        file
      ).toBe(true)
      expect(
        reports.flatMap(report => report.messages).filter(message => message.fatal),
        file
      ).toEqual([])
    }
  })

  it('does not attach project service or typed rules to Astro and Markdown virtual output', async () => {
    const root = rootFixture()
    const plan = await frameworkPlan(root)
    const runner = new ESLint({ cwd: root, overrideConfigFile: true, overrideConfig: plan.config })
    for (const file of ['src/page.astro/1_1.ts', 'README.md/0_0.ts']) {
      const config: unknown = await runner.calculateConfigForFile(join(root, file))
      expect(config).toMatchObject({
        languageOptions: { parserOptions: { projectService: false } },
        rules: { '@typescript-eslint/prefer-optional-chain': [0] }
      })
      const reports = await runner.lintText('debugger;', { filePath: file })
      expect(reports.flatMap(report => report.messages).filter(message => message.fatal)).toEqual([])
      expect(reports.flatMap(report => report.messages).some(message => message.ruleId === 'no-debugger')).toBe(true)
    }
  })

  it('rejects custom scopes that can exempt physical TypeScript from locked typed rules', async () => {
    const root = rootFixture()
    const policy = mergeLayers([
      {
        source: 'company',
        input: {
          rules: { '@typescript-eslint/no-floating-promises': 'error' },
          locked: ['@typescript-eslint/no-floating-promises']
        }
      }
    ])
    for (const pattern of [
      '**/*.ts',
      'src/**/*.ts',
      '**/*',
      '!src/**/*.ts',
      '**/*.{vue,ts}/**',
      '**/*.vue/../*.ts',
      '**/*.ts/**'
    ]) {
      await expect(
        eslintPlan({
          root,
          policy,
          biomeActive: false,
          typescript: true,
          pluginRoots: [pluginRoot],
          untypedFiles: [pattern]
        })
      ).rejects.toThrow('must descend below')
    }
  })

  it('keeps locked promise checks on current and future physical files while allowing processor fragments', async () => {
    const root = rootFixture()
    const planFor = () =>
      eslintPlan({
        root,
        policy: mergeLayers([
          {
            source: 'company',
            input: {
              rules: { '@typescript-eslint/no-floating-promises': 'error' },
              locked: ['@typescript-eslint/no-floating-promises']
            }
          }
        ]),
        biomeActive: false,
        typescript: true,
        pluginRoots: [pluginRoot],
        untypedFiles: ['**/*.vue/**']
      })
    write(root, { 'src/floating.ts': 'Promise.resolve(1);\n' })
    const plan = await planFor()
    const runner = new ESLint({ cwd: root, overrideConfigFile: true, overrideConfig: plan.config })
    for (const file of ['src/floating.ts', 'src/future.ts']) {
      write(root, { [file]: 'Promise.resolve(1);\n' })
      const config: unknown = await runner.calculateConfigForFile(join(root, file))
      expect(config).toMatchObject({ rules: { '@typescript-eslint/no-floating-promises': [2] } })
      const reports = await runner.lintFiles([file])
      expect(reports.flatMap(report => report.messages).filter(message => message.fatal)).toEqual([])
      expect(
        reports
          .flatMap(report => report.messages)
          .some(message => message.ruleId === '@typescript-eslint/no-floating-promises')
      ).toBe(true)
    }
    const virtual = await runner.lintText('Promise.resolve(1);', { filePath: 'src/component.vue/0.ts' })
    expect(virtual.flatMap(report => report.messages).filter(message => message.fatal)).toEqual([])
    expect(
      virtual
        .flatMap(report => report.messages)
        .some(message => message.ruleId === '@typescript-eslint/no-floating-promises')
    ).toBe(false)
    write(root, { 'src/component.vue/physical.ts': 'Promise.resolve(1);\n' })
    await expect(planFor()).rejects.toThrow('collides with physical directory')
  })

  it.each(['components.vue', 'components.astro', 'README.md'])(
    'rejects an ignored physical %s directory rather than treating it as virtual output',
    async directory => {
      const root = rootFixture()
      write(root, {
        '.gitignore': `src/${directory}/\n`,
        [`src/${directory}/index.ts`]: 'Promise.resolve(1);\n'
      })
      await expect(
        eslintPlan({
          root,
          policy: mergeLayers([
            {
              source: 'company',
              input: {
                rules: { '@typescript-eslint/no-floating-promises': 'error' },
                locked: ['@typescript-eslint/no-floating-promises']
              }
            }
          ]),
          biomeActive: false,
          typescript: true,
          pluginRoots: [pluginRoot],
          untypedFiles: ['**/*.vue/**']
        })
      ).rejects.toThrow('collides with physical directory')
    }
  )

  it('fails closed for empty host-shaped directories, external links, cycles and scan exhaustion', async () => {
    for (const kind of ['empty', 'external', 'cycle', 'depth']) {
      const root = rootFixture()
      if (kind === 'empty') mkdirSync(join(root, 'src/empty.astro'))
      if (kind === 'external') symlinkSync(project(), join(root, 'src/external'))
      if (kind === 'cycle') symlinkSync(root, join(root, 'src/cycle'))
      if (kind === 'depth') mkdirSync(join(root, ...Array.from({ length: 66 }, () => 'deep')), { recursive: true })
      await expect(frameworkPlan(root)).rejects.toThrow(
        kind === 'empty' ? 'collides with physical directory' : 'Cannot verify processor output scopes'
      )
    }
  })

  it('checks in-root directory aliases under each relative path and never traverses dependencies', async () => {
    const root = rootFixture()
    mkdirSync(join(root, 'origin/component.vue'), { recursive: true })
    symlinkSync(join(root, 'origin'), join(root, 'zz-alias'))
    mkdirSync(join(root, 'node_modules'))
    symlinkSync(project(), join(root, 'node_modules/external'))
    await expect(frameworkPlan(root)).resolves.toHaveProperty('config')
    await expect(
      eslintPlan({
        root,
        policy: mergeLayers([
          {
            source: 'company',
            input: {
              rules: { '@typescript-eslint/no-floating-promises': 'error' },
              locked: ['@typescript-eslint/no-floating-promises']
            }
          }
        ]),
        biomeActive: false,
        typescript: true,
        pluginRoots: [pluginRoot],
        untypedFiles: ['zz-alias/**/*.vue/**']
      })
    ).rejects.toThrow('zz-alias/component.vue')
  })

  it('reuses the shared TypeScript plugin and parser without installing a wrapper in the consumer', async () => {
    const root = rootFixture()
    const plan = await eslintPlan({
      root,
      policy: mergeLayers([
        {
          source: 'company',
          input: {
            rules: { '@typescript-eslint/no-explicit-any': 'error' },
            locked: ['@typescript-eslint/no-explicit-any']
          }
        }
      ]),
      biomeActive: false,
      typescript: true,
      baseConfig: [
        {
          files: ['**/*.ts'],
          plugins: { '@typescript-eslint': typescript.plugin },
          languageOptions: { parser: typescript.parser, parserOptions: { projectService: true, tsconfigRootDir: root } }
        }
      ]
    })
    expect(plan.notEnforced.filter(item => item.rule === '@typescript-eslint/no-explicit-any')).toEqual([])
    const runner = new ESLint({ cwd: root, overrideConfigFile: true, overrideConfig: plan.config })
    const reports = await runner.lintFiles(['src/index.ts'])
    expect(
      reports
        .flatMap(report => report.messages)
        .some(message => message.ruleId === '@typescript-eslint/no-explicit-any')
    ).toBe(true)
    expect(reports.flatMap(report => report.messages).filter(message => message.fatal)).toEqual([])
  })

  it('loads the explicit root policy from root and nested working directories in plain Node', () => {
    const root = rootFixture()
    write(root, {
      'package.json': { name: 'root-fixture', type: 'module', devDependencies: { astro: '*' } },
      'pawl.config.json': { engine: 'eslint', rules: { 'no-debugger': 'error' }, locked: ['no-debugger'] },
      'apps/docs/pawl.config.json': { engine: 'eslint', rules: { 'no-debugger': 'off' } }
    })
    const script = `
      import { eslint } from ${JSON.stringify(new URL('../src/index.ts', import.meta.url).href)};
      import { astro, pluginRoot, typescript } from ${JSON.stringify(new URL('./fixtures/eslint/plugins.ts', import.meta.url).href)};
      import { ESLint } from ${JSON.stringify(new URL('../node_modules/eslint/lib/api.js', import.meta.url).href)};
      const root = process.argv[1];
      const config = await eslint({ root, pluginRoots: [pluginRoot], baseConfig: [
        ...astro.configs['flat/recommended'],
        { files: ['**/*.astro'], languageOptions: { parserOptions: { parser: typescript.parser } } },
        { rules: { 'no-debugger': 'off' } }
      ] });
      const runner = new ESLint({ cwd: root, overrideConfigFile: true, overrideConfig: config });
      const reports = await runner.lintFiles(['src/page.astro']);
      console.log(JSON.stringify(reports.flatMap(report => report.messages.map(message => message.ruleId))));
    `
    for (const cwd of [root, join(root, 'apps/docs')]) {
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', script, root], {
        cwd,
        encoding: 'utf8',
        timeout: 30_000
      })
      expect(result.status, result.stderr).toBe(0)
      expect(result.stdout).toContain('no-debugger')
    }
  })

  it('validates real import-x implementations and retains the supplied TypeScript resolver', async () => {
    const root = rootFixture()
    const plan = await eslintPlan({
      root,
      policy: mergeLayers([{ source: 'repo', input: { rules: { 'import/no-unresolved': 'error' } } }]),
      biomeActive: false,
      typescript: false,
      plugins: { import: importPlugin },
      baseConfig: [
        {
          settings: {
            'import-x/resolver-next': [createTypeScriptImportResolver({ project: join(root, 'tsconfig.json') })]
          }
        }
      ]
    })
    expect(plan.notEnforced.filter(item => item.rule === 'import/no-unresolved')).toEqual([])
    const runner = new ESLint({ cwd: root, overrideConfigFile: true, overrideConfig: plan.config })
    const valid = await runner.lintText("import { value } from '@local/value'; console.log(value);", {
      filePath: 'src/imports.js'
    })
    const invalid = await runner.lintText("import { value } from '@local/missing'; console.log(value);", {
      filePath: 'src/imports.js'
    })
    expect(
      valid.flatMap(report => report.messages).filter(message => message.ruleId === 'import/no-unresolved')
    ).toEqual([])
    expect(invalid.flatMap(report => report.messages).some(message => message.ruleId === 'import/no-unresolved')).toBe(
      true
    )
  })
})
