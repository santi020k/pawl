import { relative } from 'node:path'
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'
import { runBiome } from '../src/engines/biome/run.ts'
import { analyzeLintTraversal } from '../src/project/lint-traversal.ts'
import { project } from './helpers.ts'

describe('removing duplicate traversal without losing engine coverage', () => {
  it('checks every representative file once per engine with one root owner', async () => {
    const root = project({
      'package.json': { name: 'root', type: 'module', scripts: { lint: 'eslint .' } },
      'apps/web/package.json': { name: 'web', type: 'module', scripts: { lint: 'eslint .' } },
      'eslint.config.js': "export default [{ rules: { 'no-alert': 'error' } }]\n",
      'biome.json': {
        formatter: { enabled: false },
        assist: { enabled: false },
        linter: { rules: { recommended: false, suspicious: { noDebugger: 'error' } } }
      },
      'src/root.js': 'debugger; alert("root")\n',
      'apps/web/src/page.js': 'debugger; alert("web")\n'
    })
    const all = new ESLint({ cwd: root })
    const pkg = new ESLint({ cwd: `${root}/apps/web` })
    const beforeRoot = await all.lintFiles(['.'])
    const beforePackage = await pkg.lintFiles(['.'])
    const violations = (reports: Awaited<ReturnType<ESLint['lintFiles']>>): string[] =>
      reports
        .filter(report => report.messages.some(message => message.ruleId === 'no-alert'))
        .map(report => relative(root, report.filePath).replaceAll('\\', '/'))
        .sort()

    expect(analyzeLintTraversal(root, ['apps/web']).overlaps).toHaveLength(1)
    expect(violations([...beforeRoot, ...beforePackage])).toEqual([
      'apps/web/src/page.js',
      'apps/web/src/page.js',
      'src/root.js'
    ])

    // Removing the package invocation retains its unique ESLint check and each invalid file.
    const after = await all.lintFiles(['.'])
    expect(violations(after)).toEqual(['apps/web/src/page.js', 'src/root.js'])
    expect(after.map(report => report.filePath).length).toBe(new Set(after.map(report => report.filePath)).size)

    // Biome's separate rule is still required: it is not removed as duplicate ESLint work.
    const biome = await runBiome({ root, files: ['src/root.js', 'apps/web/src/page.js'] })
    expect(
      biome.findings
        .filter(finding => finding.rule === 'no-debugger')
        .map(finding => finding.file)
        .sort()
    ).toEqual(['apps/web/src/page.js', 'src/root.js'])
  })
})
