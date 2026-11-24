import { describe, expect, it } from 'vitest'
import { analyzeTaskReachability } from '../src/project/task-reachability.ts'
import { project } from './helpers.ts'

const file = (root: string, path: string) => analyzeTaskReachability(root).files.find(item => item.path === path)

describe('task reachability evidence', () => {
  it('finds cached workspace task entries and their literal relative imports', () => {
    const root = project({
      'package.json': { workspaces: ['packages/*'] },
      'turbo.json': { tasks: { build: {} } },
      'packages/web/package.json': { name: '@example/web', scripts: { build: 'node build.js' } },
      'packages/web/build.js': "import '../../shared.js'\n",
      'shared.js': 'export const value = 1\n'
    })
    expect(file(root, 'shared.js')).toEqual({
      path: 'shared.js',
      reachability: 'cached',
      consumers: ['packages/web#build']
    })
    expect(analyzeTaskReachability(root).issues).toEqual([])
  })

  it('identifies direct uncached scripts and local script aliases', () => {
    const root = project({
      'package.json': { scripts: { check: 'node scripts/check.ts', alias: 'pnpm run check' } },
      'scripts/check.ts': 'console.log(1)\n'
    })
    expect(file(root, 'scripts/check.ts')).toEqual({
      path: 'scripts/check.ts',
      reachability: 'uncached',
      consumers: ['//#alias', '//#check']
    })
  })

  it('retains both cached and uncached consumers of a shared module', () => {
    const root = project({
      'package.json': { scripts: { build: 'node build.js', check: 'node check.js' } },
      'turbo.json': { tasks: { build: {}, check: { cache: false } } },
      'build.js': "import './shared.js'\n",
      'check.js': "export { value } from './shared.js'\n",
      'shared.js': 'export const value = 1\n'
    })
    expect(file(root, 'shared.js')?.reachability).toBe('mixed')
  })

  it('reports unsupported commands and dynamic imports instead of uncached exemptions', () => {
    const root = project({
      'package.json': { scripts: { check: 'node check.js', build: 'node "$ENTRY"' } },
      'check.js': 'import(process.env.MODULE)\n'
    })
    const result = analyzeTaskReachability(root)
    expect(result.issues).toEqual(
      expect.arrayContaining([
        '//#build: command entry cannot be resolved statically',
        'check.js: dynamic loading or subprocess execution needs manual review'
      ])
    )
    expect(file(root, 'check.js')?.reachability).toBe('unknown')
  })

  it('treats invalid config and package inheritance as unknown', () => {
    const root = project({
      'package.json': { scripts: { check: 'node check.js' } },
      'turbo.json': '{ invalid',
      'check.js': ''
    })
    expect(file(root, 'check.js')?.reachability).toBe('unknown')
    expect(analyzeTaskReachability(root).issues).toContain('turbo.json: invalid or unsupported Turbo configuration')
    const workspace = project({
      'package.json': { workspaces: ['apps/*'] },
      'turbo.json': { tasks: { build: {} } },
      'apps/web/package.json': { name: 'web', scripts: { build: 'node build.js' } },
      'apps/web/turbo.json': { extends: ['//'], tasks: { build: { cache: false } } },
      'apps/web/build.js': ''
    })
    expect(file(workspace, 'apps/web/build.js')?.reachability).toBe('unknown')
  })

  it('honors qualified tasks, JSONC and explicit cache false', () => {
    const root = project({
      'package.json': { workspaces: ['apps/*'] },
      'turbo.jsonc': '{ // tasks\n "tasks": {"build": {}, "web#build": {"cache": false}}}',
      'apps/web/package.json': { name: 'web', scripts: { build: 'node build.js' } },
      'apps/web/build.js': ''
    })
    expect(file(root, 'apps/web/build.js')?.reachability).toBe('uncached')
  })

  it('refuses missing files, paths outside the root and cyclic aliases', () => {
    const root = project({
      'package.json': { scripts: { missing: 'node absent.js', outside: 'node ../outside.js', cycle: 'npm run cycle' } }
    })
    const result = analyzeTaskReachability(root, ['../outside'])
    expect(result.files).toEqual([])
    expect(result.issues).toHaveLength(4)
  })

  it('distinguishes bare standalone tasks from generic workspace tasks', () => {
    const root = project({
      'package.json': { scripts: { build: 'node build.js' } },
      'turbo.json': { tasks: { build: {} } },
      'build.js': ''
    })
    expect(file(root, 'build.js')?.reachability).toBe('cached')
    const workspace = project({
      'package.json': { workspaces: ['apps/*'], scripts: { build: 'node build.js' } },
      'apps/web/package.json': { name: 'web' },
      'turbo.json': { tasks: { build: {} } },
      'build.js': ''
    })
    expect(file(workspace, 'build.js')?.reachability).toBe('uncached')
  })

  it('accepts registered workspace root tasks but reports qualified standalone tasks as unknown', () => {
    const standalone = project({
      'package.json': { scripts: { build: 'node build.js' } },
      'turbo.json': { tasks: { '//#build': {} } },
      'build.js': ''
    })
    expect(file(standalone, 'build.js')?.reachability).toBe('unknown')
    expect(analyzeTaskReachability(standalone).issues).toContain(
      'turbo.json: qualified task names are invalid in a standalone project; use bare task names'
    )
    const workspace = project({
      'package.json': { scripts: { build: 'node build.js' } },
      'pnpm-workspace.yaml': 'packages:\n  - apps/*\n',
      'apps/web/package.json': { name: 'web' },
      'turbo.json': { tasks: { '//#build': {} } },
      'build.js': ''
    })
    expect(file(workspace, 'build.js')?.reachability).toBe('cached')
  })

  it('marks evidence incomplete even when every declared command is supported', () => {
    const root = project({
      'package.json': { scripts: { check: 'node check.js' } },
      'check.js': ''
    })
    expect(analyzeTaskReachability(root).complete).toBe(false)
  })

  it('reports root config inheritance and lifecycle scripts as uncertain', () => {
    const root = project({
      'package.json': { scripts: { test: 'node check.js', pretest: 'node setup.js' } },
      'turbo.json': { extends: ['shared'], tasks: { '//#test': {} } },
      'check.js': '',
      'setup.js': ''
    })
    expect(file(root, 'check.js')?.reachability).toBe('unknown')
    expect(analyzeTaskReachability(root).issues).toContain('//#test: lifecycle scripts require manual review')
  })

  it('does not overlook commented import calls or indirect require use', () => {
    for (const source of ["import /* comment */ ('./shared.js')", "Reflect.apply(require, null, ['./shared.js'])"]) {
      const root = project({
        'package.json': { scripts: { check: 'node check.js' } },
        'check.js': source,
        'shared.js': ''
      })
      expect(file(root, 'check.js')?.reachability).toBe('unknown')
    }
  })

  it('follows multiline imports and terminates module cycles', () => {
    const root = project({
      'package.json': { scripts: { build: 'node build.js' } },
      'turbo.json': { tasks: { build: {} } },
      'build.js': "import {\n value\n} from './shared.js'\n",
      'shared.js': "import './build.js'\nexport const value = 1\n"
    })
    expect(file(root, 'shared.js')?.reachability).toBe('cached')
    expect(analyzeTaskReachability(root).files).toHaveLength(2)
  })
})
