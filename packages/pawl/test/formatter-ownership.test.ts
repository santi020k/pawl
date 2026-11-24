import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { check } from '../src/check/check.ts'
import { exitCode } from '../src/check/result.ts'
import { runBiome } from '../src/engines/biome/run.ts'
import { formatterOwnership } from '../src/engines/eslint/format-ownership.ts'
import { loadProject } from '../src/policy/project.ts'
import { applyPlan } from '../src/setup/plan.ts'
import { planSync } from '../src/setup/sync.ts'
import { link, project, write } from './helpers.ts'

const source = "import { z } from './z.js'\nimport { a } from './a.js'\nexport const value = [z, a]\n"
const fixture = async (sort: boolean, scoped = false): Promise<string> => {
  const root = project({
    'package.json': { name: 'format-owner', type: 'module' },
    'pawl.config.json': { engine: 'auto' },
    'eslint.config.js': `export default [{ ${scoped ? "files: ['scripts/**']," : ''} rules: { 'sort-imports': '${sort ? 'error' : 'off'}', 'no-debugger': 'error' } }]\n`,
    'src/index.js': source,
    'src/a.js': 'export const a = 1\n',
    'src/z.js': 'export const z = 2\n',
    'scripts/task.js': source
  })
  link(root, { eslint: true })
  applyPlan(await planSync(root))
  return root
}

describe('import formatter ownership', () => {
  it('blocks competing owners before full or file-scoped fixes can write', async () => {
    const root = await fixture(true)
    const config = readFileSync(join(root, 'eslint.config.js'), 'utf8')
    for (const files of [undefined, ['src/index.js']]) {
      const result = await check({ root, fix: true, ...(files ? { files } : {}) })
      expect(exitCode(result)).toBe(2)
      expect(result.setup.some(issue => issue.message.includes('Competing import formatters'))).toBe(true)
      expect(result.commands).toEqual([])
      expect(readFileSync(join(root, 'src/index.js'), 'utf8')).toBe(source)
      expect(readFileSync(join(root, 'eslint.config.js'), 'utf8')).toBe(config)
    }
  })

  it('uses actual resolved file scopes instead of rejecting unrelated files', async () => {
    const root = await fixture(true, true)
    const result = await check({ root, files: ['src/index.js'] })
    expect(result.setup.filter(issue => issue.message.includes('Competing import formatters'))).toEqual([])
    const script = await check({ root, files: ['scripts/task.js'] })
    expect(exitCode(script)).toBe(2)
    expect(script.setup.some(issue => issue.message.includes('scripts/task.js'))).toBe(true)
  })

  it('reaches a stable fix/check/fix result with one owner and retains semantic checks', async () => {
    const root = await fixture(false)
    const first = await check({ root, fix: true, files: ['src'] })
    expect(first.setup).toEqual([])
    const formatted = readFileSync(join(root, 'src/index.js'), 'utf8')
    expect(exitCode(await check({ root, files: ['src'] }))).toBe(0)
    expect(exitCode(await check({ root, fix: true, files: ['src'] }))).toBe(0)
    expect(readFileSync(join(root, 'src/index.js'), 'utf8')).toBe(formatted)
    write(root, { 'src/invalid.js': 'debugger\n' })
    const invalid = await check({ root, files: ['src/invalid.js'] })
    expect(invalid.findings.some(finding => finding.engine === 'eslint' && finding.rule === 'no-debugger')).toBe(true)
  })

  it('respects explicit global Biome exclusions for disjoint file ownership', async () => {
    const root = await fixture(true, true)
    const config = JSON.parse(readFileSync(join(root, 'biome.json'), 'utf8')) as Record<string, unknown>
    config.files = { includes: ['**', '!scripts/**'] }
    write(root, { 'biome.json': config })
    expect(await formatterOwnership(await loadProject(root), ['scripts/task.js'])).toEqual([])
    expect((await runBiome({ root, files: ['scripts/task.js'] })).findings).toEqual([])
  })

  it('does not trust root opt-outs when custom inheritance can re-enable scoped actions', async () => {
    const root = await fixture(true, true)
    write(root, {
      'shared.json': {
        extends: ['@santi020k/pawl/biome'],
        overrides: [{ includes: ['scripts/**'], assist: { actions: { source: { organizeImports: 'on' } } } }]
      },
      'biome.json': { extends: ['./shared.json'], assist: { actions: { source: { organizeImports: 'off' } } } }
    })
    const issues = await formatterOwnership(await loadProject(root), ['scripts/task.js'])
    expect(issues.some(issue => issue.message.includes('Cannot establish'))).toBe(true)
    const actual = await runBiome({ root, files: ['scripts/task.js'] })
    expect(actual.findings.some(finding => finding.rule === 'pawl/organize-imports')).toBe(true)
  })

  it('accepts an explicit Biome source-action opt-out', async () => {
    const root = await fixture(true)
    const path = join(root, 'biome.json')
    const config = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    config.assist = { actions: { source: { organizeImports: 'off' } } }
    write(root, { 'biome.json': config })
    const result = await check({ root, files: ['src/index.js'] })
    expect(
      result.setup.filter(
        issue => issue.message.includes('formatter ownership') || issue.message.includes('Competing import')
      )
    ).toEqual([])
  })
})
