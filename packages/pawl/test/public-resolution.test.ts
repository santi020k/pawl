import { spawnSync } from 'node:child_process'
import { existsSync, realpathSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { importPlugin } from '../src/engines/eslint/load.ts'
import { eslintPlan } from '../src/engines/eslint/plan.ts'
import { resolveSpecifier } from '../src/policy/load.ts'
import { defaultPolicy } from '../src/policy/merge.ts'
import { project, write } from './helpers.ts'

const consumer = (exports: unknown): string =>
  project({
    'package.json': { name: 'consumer' },
    'node_modules/shared/package.json': { name: 'shared', type: 'module', exports, main: './private.js' },
    'node_modules/shared/public.js': 'export default {}',
    'node_modules/shared/feature.js': 'export default {}',
    'node_modules/shared/private.js': 'export default {}'
  })

describe('public project export resolution', () => {
  it('resolves linked public roots and subpaths to their installed files without exposing private entries', () => {
    const root = project({
      'package.json': { name: 'consumer' },
      'node_modules/.pnpm/shared/node_modules/shared/package.json': {
        name: 'shared',
        type: 'module',
        exports: { '.': { import: './public.js' }, './feature': { import: './feature.js' }, './private': null }
      },
      'node_modules/.pnpm/shared/node_modules/shared/public.js': 'export default {}',
      'node_modules/.pnpm/shared/node_modules/shared/feature.js': 'export default {}',
      'node_modules/.pnpm/shared/node_modules/shared/private.js': 'export default {}'
    })
    const installed = join(root, 'node_modules/.pnpm/shared/node_modules/shared')
    symlinkSync(installed, join(root, 'node_modules/shared'))
    expect(resolveSpecifier('shared', join(root, 'config.js'))).toBe(join(installed, 'public.js'))
    expect(resolveSpecifier('shared/feature', join(root, 'config.js'))).toBe(join(installed, 'feature.js'))
    expect(() => resolveSpecifier('shared/private', join(root, 'config.js'))).toThrow('does not export')
    expect(() => resolveSpecifier('shared/private.js', join(root, 'config.js'))).toThrow('does not export')
  })

  it('loads the JavaScript base pack beside linked ESLint without a direct dependency', async () => {
    const root = project({
      'package.json': { name: 'isolated-eslint', type: 'module' },
      'node_modules/.pnpm/eslint/node_modules/eslint/package.json': {
        name: 'eslint',
        type: 'module',
        exports: { './package.json': './package.json' }
      },
      'node_modules/.pnpm/eslint/node_modules/@eslint/js/package.json': {
        name: '@eslint/js',
        type: 'module',
        exports: './index.js'
      },
      'node_modules/.pnpm/eslint/node_modules/@eslint/js/index.js':
        "export default { configs: { recommended: { rules: { 'no-undef': 'error' } } } }"
    })
    symlinkSync(join(root, 'node_modules/.pnpm/eslint/node_modules/eslint'), join(root, 'node_modules/eslint'))
    expect(existsSync(join(root, 'node_modules/@eslint/js'))).toBe(false)
    expect(() => resolveSpecifier('@eslint/js', join(root, 'package.json'))).toThrow('Cannot find')
    expect(resolveSpecifier('eslint/package.json', join(root, 'package.json'))).toBe(
      realpathSync(join(root, 'node_modules/eslint/package.json'))
    )
    expect(await importPlugin(root, '@eslint/js')).toMatchObject({
      module: { configs: { recommended: { rules: { 'no-undef': 'error' } } } }
    })
    const plan = await eslintPlan({ root, policy: defaultPolicy(), biomeActive: false, typescript: false })
    expect(plan.activePacks).toContain('javascript')
    expect(plan.notEnforced.some(entry => entry.rule === 'The JavaScript pack')).toBe(false)
  })

  it('resolves import-only roots and explicit public subpaths', () => {
    const root = consumer({ '.': { import: './public.js' }, './feature': { import: './feature.js' } })
    expect(resolveSpecifier('shared', join(root, 'config.js'))).toBe(join(root, 'node_modules/shared/public.js'))
    expect(resolveSpecifier('shared/feature', join(root, 'config.js'))).toBe(
      join(root, 'node_modules/shared/feature.js')
    )
    expect(() => resolveSpecifier('shared/private.js', join(root, 'config.js'))).toThrow('does not export')
  })

  it('honors declaration order and explicit denial instead of falling through to main', () => {
    const first = consumer({ default: './public.js', import: './feature.js' })
    expect(resolveSpecifier('shared', join(first, 'config.js'))).toBe(join(first, 'node_modules/shared/public.js'))
    const denied = consumer({ node: null, default: './public.js' })
    expect(() => resolveSpecifier('shared', join(denied, 'config.js'))).toThrow('does not export')
    const blocked = consumer(null)
    expect(() => resolveSpecifier('shared', join(blocked, 'config.js'))).toThrow('does not export')
  })

  it('does not discover a plugin installed only in the test host', () => {
    const root = project({ 'package.json': { name: 'isolated' } })
    expect(() => resolveSpecifier('typescript-eslint', join(root, 'config.js'))).toThrow('Cannot find')
    expect(() => resolveSpecifier('@vitest/eslint-plugin', join(root, 'config.js'))).toThrow('Cannot find')
  })

  it('supports package self references through public exports', () => {
    const root = project({
      'package.json': { name: 'self', exports: { './policy': { import: './policy.js' } } },
      'policy.js': 'export default {}'
    })
    expect(resolveSpecifier('self/policy', join(root, 'src/config.js'))).toBe(join(root, 'policy.js'))
    expect(() => resolveSpecifier('self/private', join(root, 'src/config.js'))).toThrow('does not export')
  })

  it('rejects unsafe targets and unsupported pattern exports without private fallback', () => {
    const unsafe = consumer('./../private.js')
    expect(() => resolveSpecifier('shared', join(unsafe, 'config.js'))).toThrow('unsafe export')
    const pattern = consumer({ './*': './*.js' })
    expect(() => resolveSpecifier('shared/feature', join(pattern, 'config.js'))).toThrow('explicit public entry')
  })
})

describe('active Node export conditions', () => {
  const cases: Array<{
    name: string
    exports: Record<string, string>
    args: string[]
    nodeOptions: string
    selected: string
  }> = [
    {
      name: 'module-sync',
      exports: { 'module-sync': './strict.js', default: './weak.js' },
      args: [],
      nodeOptions: '',
      selected: 'strict'
    },
    {
      name: 'disabled require-module',
      exports: { 'module-sync': './strict.js', default: './weak.js' },
      args: ['--no-experimental-require-module'],
      nodeOptions: '',
      selected: 'weak'
    },
    {
      name: 'custom CLI condition',
      exports: { custom: './strict.js', default: './weak.js' },
      args: ['--conditions=custom'],
      nodeOptions: '',
      selected: 'strict'
    },
    {
      name: 'short CLI condition',
      exports: { custom: './strict.js', default: './weak.js' },
      args: ['-C', 'custom'],
      nodeOptions: '',
      selected: 'strict'
    },
    {
      name: 'custom environment condition',
      exports: { custom: './strict.js', default: './weak.js' },
      args: [],
      nodeOptions: '--conditions=custom',
      selected: 'strict'
    },
    {
      name: 'quoted environment condition',
      exports: { 'custom branch': './strict.js', default: './weak.js' },
      args: [],
      nodeOptions: '--conditions="custom branch"',
      selected: 'strict'
    },
    {
      name: 'no addons',
      exports: { 'node-addons': './strict.js', default: './weak.js' },
      args: ['--no-addons'],
      nodeOptions: '',
      selected: 'weak'
    },
    {
      name: 'CLI overrides environment addon setting',
      exports: { 'node-addons': './strict.js', default: './weak.js' },
      args: ['--addons'],
      nodeOptions: '--no-addons',
      selected: 'strict'
    },
    {
      name: 'addon spelling accepted by Node',
      exports: { 'node-addons': './strict.js', default: './weak.js' },
      args: ['--no_addons=false'],
      nodeOptions: '',
      selected: 'weak'
    },
    {
      name: 'declaration order before a custom condition',
      exports: { default: './weak.js', custom: './strict.js' },
      args: ['--conditions=custom'],
      nodeOptions: '',
      selected: 'weak'
    },
    {
      name: 'custom module-sync with require disabled',
      exports: { 'module-sync': './strict.js', default: './weak.js' },
      args: ['--no-experimental-require-module', '--conditions=module-sync'],
      nodeOptions: '',
      selected: 'strict'
    },
    {
      name: 'CLI and environment conditions accumulate',
      exports: { environment: './strict.js', command: './weak.js', default: './weak.js' },
      args: ['--conditions=command'],
      nodeOptions: '--conditions=environment',
      selected: 'strict'
    }
  ]

  it.each(cases)('matches actual dynamic import for $name', ({ exports, args, nodeOptions, selected }) => {
    const root = project({
      'package.json': { name: 'runtime-consumer', type: 'module' },
      'node_modules/shared/package.json': { name: 'shared', type: 'module', exports },
      'node_modules/shared/strict.js': "export default 'strict'",
      'node_modules/shared/weak.js': "export default 'weak'",
      'probe.mjs': `
        import { pathToFileURL } from 'node:url';
        import { resolveSpecifier } from ${JSON.stringify(new URL('../src/policy/load.ts', import.meta.url).href)};
        const actual = (await import('shared')).default;
        const resolved = resolveSpecifier('shared', import.meta.filename);
        const planned = (await import(pathToFileURL(resolved).href)).default;
        console.log(JSON.stringify({ actual, planned }));
      `
    })
    const result = spawnSync(process.execPath, [...args, join(root, 'probe.mjs')], {
      cwd: root,
      env: { ...process.env, NODE_OPTIONS: nodeOptions },
      encoding: 'utf8',
      timeout: 30_000
    })
    expect(result.status, result.stderr).toBe(0)
    const output: unknown = JSON.parse(result.stdout)
    expect(output).toEqual({ actual: selected, planned: selected })
  })

  it('rejects experimental Node configuration as an uncertain source of conditions', () => {
    const root = consumer({ custom: './feature.js', default: './public.js' })
    write(root, {
      'node.config.json': { nodeOptions: { conditions: ['custom'] } },
      'node_modules/shared/feature.js': "export default 'custom'",
      'probe.mjs': `
        import { resolveSpecifier } from ${JSON.stringify(new URL('../src/policy/load.ts', import.meta.url).href)};
        try { resolveSpecifier('shared', import.meta.filename); process.exitCode = 1; }
        catch (error) { console.log(error instanceof Error && error.message.includes('experimental Node configuration')); }
      `
    })
    const result = spawnSync(
      process.execPath,
      [`--experimental-config-file=${join(root, 'node.config.json')}`, join(root, 'probe.mjs')],
      {
        env: { ...process.env, NODE_OPTIONS: '' },
        encoding: 'utf8',
        timeout: 30_000
      }
    )
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout.trim()).toBe('true')
  })

  it('rejects ambiguous option arity instead of selecting a fallback condition', () => {
    const root = consumer({ custom: './feature.js', default: './public.js' })
    const script = `
      import { resolveSpecifier } from ${JSON.stringify(new URL('../src/policy/load.ts', import.meta.url).href)};
      try { resolveSpecifier('shared', process.argv[1]); process.exitCode = 1; }
      catch (error) { console.log(error instanceof Error && error.message.includes('unknown option may consume')); }
    `
    const result = spawnSync(
      process.execPath,
      ['--expose-gc', '--conditions=custom', '--input-type=module', '-e', script, join(root, 'config.js')],
      {
        env: { ...process.env, NODE_OPTIONS: '' },
        encoding: 'utf8',
        timeout: 30_000
      }
    )
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout.trim()).toBe('true')
  })

  it('captures flag inputs before callers mutate the environment and argument arrays', () => {
    const root = consumer({ custom: './feature.js', default: './public.js' })
    const script = `
      import { resolveSpecifier } from ${JSON.stringify(new URL('../src/policy/load.ts', import.meta.url).href)};
      process.env.NODE_OPTIONS = '--conditions=custom';
      process.execArgv.push('--conditions=custom');
      console.log(resolveSpecifier('shared', process.argv[1]).endsWith('/public.js'));
    `
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script, join(root, 'config.js')], {
      env: { ...process.env, NODE_OPTIONS: '' },
      encoding: 'utf8',
      timeout: 30_000
    })
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout.trim()).toBe('true')
  })

  it('fails clearly when environment option parsing is uncertain', () => {
    const root = consumer({ default: './public.js' })
    const script = `
      process.env.NODE_OPTIONS = '--conditions="unterminated';
      const { resolveSpecifier } = await import(${JSON.stringify(new URL('../src/policy/load.ts', import.meta.url).href)});
      try { resolveSpecifier('shared', process.argv[1]); process.exitCode = 1; }
      catch (error) { console.log(error instanceof Error && error.message.includes('Cannot determine public export conditions')); }
    `
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script, join(root, 'config.js')], {
      env: { ...process.env, NODE_OPTIONS: '' },
      encoding: 'utf8',
      timeout: 30_000
    })
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout.trim()).toBe('true')
  })
})
