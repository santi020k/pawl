import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, it as test } from 'vitest'
import { type DoctorReport, doctor, formatDoctor } from '../src/doctor.ts'
import { BIOME_VERSION } from '../src/engines/biome.ts'
import { applyInit, formatWritten, planInit } from '../src/init.ts'
import { link, PACKAGE_ROOT, project } from './helpers.ts'

const ready = async (files: Record<string, string | object> = {}): Promise<string> => {
  const root = project({ 'package.json': { name: 'fixture', private: true, type: 'module' }, ...files })

  link(root)

  const plan = await planInit({ root, install: false, editor: false })

  applyInit(plan)
  // As init does: pawl formats what it wrote, so its own files pass its own check.
  await formatWritten(
    root,
    plan.actions.map(action => action.path)
  )

  return root
}

describe('pawl doctor', () => {
  it('reports the setup, the tool versions and the packs the files call for', async () => {
    const report = await doctor(await ready({ 'README.md': '# fixture\n', '.github/workflows/ci.yml': 'on: push\n' }))

    expect(report.problems).toEqual([])
    expect(report.linter).toBe('biome')
    expect(report.project.runtimes).toEqual(['node', 'browser'])
    expect(report.engines.biome).toEqual({ installed: true, config: 'biome.json', status: 'ok' })
    expect(report.compatibility).toEqual([
      { name: 'node', wanted: '>=22.18.0', installed: process.versions.node, ok: true },
      { name: '@biomejs/biome', wanted: BIOME_VERSION, installed: BIOME_VERSION, ok: true }
    ])
    expect(report.suggestedPacks).toEqual(['markdown', 'yaml'])
    expect(formatDoctor(report)).toContain(
      'Suggest:  markdown, yaml for the files in this repo (pawl add markdown yaml)'
    )
    expect(formatDoctor(report)).toContain(`Biome:    ${BIOME_VERSION}, biome.json in line with the policy`)
  })

  it('reports a Biome other than the one pawl pins, and an ESLint older than it supports', async () => {
    const root = await ready({
      'pawl.config.json': { engine: 'eslint' },
      'node_modules/@biomejs/biome/package.json': { name: '@biomejs/biome', version: '2.5.0' },
      'node_modules/@biomejs/biome/bin/biome': '',
      'node_modules/eslint/package.json': { name: 'eslint', version: '8.57.0' },
      'node_modules/eslint/bin/eslint.js': ''
    })
    const report = await doctor(root)

    expect(report.compatibility).toContainEqual({
      name: '@biomejs/biome',
      wanted: BIOME_VERSION,
      installed: '2.5.0',
      ok: false
    })
    expect(report.problems).toContain(
      `@biomejs/biome 2.5.0 is not a version pawl works with (${BIOME_VERSION}). Install @biomejs/biome@${BIOME_VERSION}.`
    )
    expect(report.problems).toContain(
      'eslint 8.57.0 is not a version pawl works with (>=9.22.0). Install eslint@">=9.22.0".'
    )
  })
})

describe('pawl init', () => {
  it('suggests the packs the files call for, along with the ones the dependencies do', async () => {
    const root = project({ 'package.json': { name: 'fixture', dependencies: { zod: '4' } }, 'docs/guide.md': '# hi\n' })
    const plan = await planInit({ root, install: false, editor: false })

    expect(plan.notes).toContain(
      'Optional packs that fit this project: zod markdown. Each needs an ESLint plugin. Add them with "pawl add zod markdown".'
    )
  })
})

describe.runIf(existsSync(join(PACKAGE_ROOT, 'dist/cli.js')))('the CLI', { timeout: 60_000 }, () => {
  const run = (root: string, ...args: string[]) => {
    const result = spawnSync(process.execPath, [join(PACKAGE_ROOT, 'dist/cli.js'), ...args], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, CI: '', NO_COLOR: '1' }
    })

    return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr }
  }

  test('prints the doctor report as JSON for CI, and refuses the agent format for it', async () => {
    const root = await ready()
    const result = run(root, 'doctor', '--format', 'json')
    const report = JSON.parse(result.stdout) as DoctorReport

    expect(result.code).toBe(0)
    expect(report).toMatchObject({ problems: [], linter: 'biome', formatter: 'biome' })
    expect(run(root, 'doctor', '--format', 'agent')).toMatchObject({
      code: 2,
      stderr: 'pawl: Unknown format "agent" for doctor. Use pretty or json.\n'
    })
  })

  test('fails on more warnings than --max-warnings allows, and on a limit that is not a number', async () => {
    const root = await ready({ 'src/a.js': "console.log('hi')\n", '.pawl/baseline.json': { version: 1, findings: {} } })

    expect(run(root, 'check').code).toBe(0)
    expect(run(root, 'check', '--max-warnings', '1').code).toBe(0)
    expect(run(root, 'check', '--max-warnings', '0')).toMatchObject({
      code: 1,
      stdout: expect.stringContaining('The limit is 0 warnings, so the warnings fail the check.')
    })
    expect(run(root, 'check', '--max-warnings', 'many')).toMatchObject({
      code: 2,
      stderr: 'pawl: --max-warnings takes a whole number, such as 0. Got "many".\n'
    })
  })
})
