import { describe, expect, it } from 'vitest'
import { doctor, formatDoctor } from '../src/report/doctor.ts'
import { project } from './helpers.ts'

describe('doctor task ownership evidence', () => {
  it('includes overlap and explicit task uncertainty without changing setup or coverage rules', async () => {
    const root = project({
      'package.json': { name: 'root', scripts: { lint: 'eslint .', build: 'node scripts/build.js' } },
      'pnpm-workspace.yaml': 'packages:\n  - "apps/*"\n',
      'turbo.json': { tasks: { build: {}, '//#build': {} } },
      'scripts/build.js': 'process.stdout.write("build")\n',
      'apps/web/package.json': { name: 'web', scripts: { lint: 'eslint .', build: 'node build.js' } },
      'apps/web/build.js': 'process.stdout.write("web")\n'
    })
    const report = await doctor(root)
    const output = formatDoctor(report)

    expect(report.lintTraversal.overlaps).toHaveLength(1)
    expect(report.taskReachability.tasks.some(task => task.cache === 'cached')).toBe(true)
    expect(report.taskReachability.issues.some(issue => issue.includes('cannot be resolved statically'))).toBe(true)
    expect(output).toContain('may both visit apps/web')
    expect(output).toContain('not a lint exemption')
    expect(report.problems.every(problem => !problem.includes('traversal'))).toBe(true)
  })

  it('does not invent Turbo tasks when there is no Turbo configuration', async () => {
    const report = await doctor(project({ 'package.json': { scripts: { test: 'node test.js' } } }))

    expect(report.taskReachability).toEqual({ complete: false, tasks: [], files: [], issues: [] })
  })
})
