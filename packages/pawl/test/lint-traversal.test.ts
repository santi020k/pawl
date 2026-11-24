import { describe, expect, it } from 'vitest'
import { analyzeLintTraversal } from '../src/project/lint-traversal.ts'
import { project } from './helpers.ts'

describe('declared lint traversal ownership', () => {
  it('reports overlapping root and package commands without treating different engines as duplicates', () => {
    const root = project({
      'package.json': { scripts: { lint: 'eslint .', format: 'biome check .' } },
      'apps/web/package.json': { scripts: { lint: 'pnpm exec eslint .' } },
      'apps/web/src/page.js': 'export const page = 1\n'
    })
    const report = analyzeLintTraversal(root, ['apps/web'])

    expect(report.overlaps).toEqual([
      {
        first: { manifest: 'package.json', script: 'lint', tool: 'eslint', directory: '' },
        second: { manifest: 'apps/web/package.json', script: 'lint', tool: 'eslint', directory: 'apps/web' },
        directory: 'apps/web'
      }
    ])
    expect(report.unknown).toEqual([])
  })

  it('does not flag disjoint roots, file-only targets or check/fix alternatives in one manifest', () => {
    const root = project({
      'package.json': { scripts: { lint: 'eslint src', fix: 'eslint src --fix', one: 'pawl check app.js' } },
      'src/index.js': 'export const root = 1\n',
      'app.js': 'export const app = 1\n',
      'apps/web/package.json': { scripts: { lint: 'eslint .' } }
    })

    expect(analyzeLintTraversal(root, ['apps/web'])).toMatchObject({ overlaps: [], unknown: [] })
  })

  it('includes pawl orchestration as a potential overlap, preserving unknown scopes', () => {
    const root = project({
      'package.json': {
        scripts: { lint: 'pawl check', changed: 'pawl check --changed', chain: 'eslint . && echo done' }
      },
      'apps/web/package.json': { scripts: { lint: 'biome lint .', dynamic: 'eslint "$TARGET"' } }
    })
    const report = analyzeLintTraversal(root, ['apps/web'])

    expect(report.overlaps).toHaveLength(1)
    expect(report.overlaps[0]?.directory).toBe('apps/web')
    expect(report.unknown).toHaveLength(3)
    expect(report.unknown.every(message => message.includes('scope is unknown'))).toBe(true)
  })

  it('does not guess globs, missing paths, out-of-root targets or unsupported flags', () => {
    const root = project({
      'package.json': {
        scripts: { glob: 'eslint src/**', missing: 'eslint missing', outside: 'eslint ../', flag: 'eslint --ext .js .' }
      }
    })

    expect(analyzeLintTraversal(root)).toMatchObject({ commands: [], overlaps: [] })
    expect(analyzeLintTraversal(root).unknown).toHaveLength(4)
  })

  it('accepts explicit directory targets after known report/config flags', () => {
    const root = project({
      'package.json': { scripts: { lint: 'pnpm exec eslint --config eslint.config.js --format json .' } }
    })

    expect(analyzeLintTraversal(root).commands).toEqual([
      { manifest: 'package.json', script: 'lint', tool: 'eslint', directory: '' }
    ])
  })

  it('keeps ambiguous package-script shorthand unknown', () => {
    const root = project({
      'package.json': { scripts: { eslint: 'node wrapper.js', lint: 'pnpm eslint .', other: 'yarn eslint .' } },
      'wrapper.js': 'process.stdout.write("wrapper")\n'
    })
    const report = analyzeLintTraversal(root)

    expect(report.commands).toEqual([])
    expect(report.unknown).toHaveLength(2)
  })

  it('recognizes Biome CI traversal alongside a workspace check', () => {
    const root = project({
      'package.json': { scripts: { lint: 'biome ci .' } },
      'apps/web/package.json': { scripts: { lint: 'biome check .' } }
    })

    expect(analyzeLintTraversal(root, ['apps/web']).overlaps).toHaveLength(1)
  })
})
