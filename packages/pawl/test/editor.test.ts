import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { helpText, unknownCommand, usageFrom } from '../src/cli/args.ts'
import { type DoctorReport, doctorRows } from '../src/report/doctor.ts'
import { planEditor } from '../src/setup/integrations.ts'
import { createStyle, stripAnsi } from '../src/utils/terminal.ts'
import { project } from './helpers.ts'

const tasksOf = (root: string, file: string): unknown => JSON.parse(readFileSync(join(root, file), 'utf8')) as unknown

const apply = (root: string): { paths: string[]; notes: string[] } => {
  const notes: string[] = []
  const actions = planEditor(root, 'biome', notes)

  for (const action of actions) action.apply()

  return { paths: actions.map(action => action.path), notes }
}

describe('editor tasks', () => {
  it('gives VS Code tasks whose problem matcher reads --format editor', () => {
    const root = project()
    const { paths } = apply(root)
    const { tasks } = tasksOf(root, '.vscode/tasks.json') as {
      tasks: { label: string; command: string; problemMatcher: { pattern: { regexp: string } } }[]
    }

    expect(paths).toContain('.vscode/tasks.json')
    expect(paths).not.toContain('.zed/tasks.json')
    expect(tasks.map(task => [task.label, task.command])).toEqual([
      ['pawl: check', 'npx --no pawl check --format editor'],
      ['pawl: fix', 'npx --no pawl fix --format editor']
    ])

    const pattern = new RegExp(tasks[0]?.problemMatcher.pattern.regexp ?? '')

    expect(
      pattern.exec('src/a b.ts:3:7: warning: Use [] not Array(). [biome:style/useConsistentArrayType]')?.slice(1)
    ).toEqual(['src/a b.ts', '3', '7', 'warning', 'Use [] not Array().', 'biome:style/useConsistentArrayType'])
    // Quality prints the same shape, with an info severity as well, so the matcher reads its lines too.
    expect(pattern.exec('src/lib.rs:7:5: info: Unneeded unit expression. [clippy::unused_unit]')?.slice(1)).toEqual([
      'src/lib.rs',
      '7',
      '5',
      'info',
      'Unneeded unit expression.',
      'clippy::unused_unit'
    ])
    expect(pattern.exec('pawl: error: No biome.json found. [pawl/setup:biome-config-missing]')).toBeNull()
  })

  it("adds only the tasks a tasks file does not have, and keeps the user's own", () => {
    const mine = { label: 'pawl: check', type: 'shell', command: 'pnpm pawl check --format editor' }
    const root = project({ '.vscode/tasks.json': { version: '2.0.0', tasks: [{ label: 'build' }, mine] } })

    apply(root)

    expect(tasksOf(root, '.vscode/tasks.json')).toMatchObject({
      version: '2.0.0',
      tasks: [{ label: 'build' }, mine, { label: 'pawl: fix' }]
    })
    expect(apply(root).paths).not.toContain('.vscode/tasks.json')
  })

  it('swaps the command of a pawl task an earlier version wrote, and leaves the rest of the task', () => {
    const old = { label: 'pawl: check', type: 'shell', command: 'npx pawl check --format editor', group: 'test' }
    const root = project({ '.vscode/tasks.json': { version: '2.0.0', tasks: [old] } })

    apply(root)

    expect(tasksOf(root, '.vscode/tasks.json')).toMatchObject({
      tasks: [{ ...old, command: 'npx --no pawl check --format editor' }, { label: 'pawl: fix' }]
    })
    expect(apply(root).paths).not.toContain('.vscode/tasks.json')
  })

  it('leaves a tasks file with comments alone, and says what to add', () => {
    const root = project({ '.vscode/tasks.json': '// mine\n{ "version": "2.0.0", "tasks": [] }\n' })
    const { paths, notes } = apply(root)

    expect(paths).not.toContain('.vscode/tasks.json')
    expect(notes).toContain(
      '.vscode/tasks.json has comments or could not be read, so pawl did not add its tasks. Add a "pawl: check" task by hand.'
    )
  })

  it("gives Zed its tasks where the repo has Zed's folder", () => {
    const root = project({ '.zed/settings.json': {} })
    const { paths } = apply(root)

    expect(paths).toContain('.zed/tasks.json')
    expect(tasksOf(root, '.zed/tasks.json')).toEqual([
      { label: 'pawl: check', command: 'npx --no pawl check', use_new_terminal: false, reveal: 'always', save: 'all' },
      { label: 'pawl: fix', command: 'npx --no pawl fix', use_new_terminal: false, reveal: 'always', save: 'all' }
    ])
  })
})

describe('the help', () => {
  it('lists every option in plain text, and the commands first for a person', () => {
    const plain = helpText()
    const rich = stripAnsi(helpText(undefined, createStyle(1)))

    expect(plain).toContain('  pawl init             Set up this repo\n')
    expect(plain).toContain('  --format <kind>       pretty, agent, editor, github, sarif or json (see Output below)\n')
    expect(plain).toContain('  PAWL_AGENT=0|1        Say whether a coding agent is running pawl')
    expect(plain).toContain("For a coding agent's hooks: after an edit, when it stops, and before")
    expect(plain).toContain('except for a coding agent and in GitHub Actions')
    expect(plain).toContain('The default when a coding agent runs pawl, in GitHub Actions too')
    expect(plain).not.toContain('post-edit hook')
    expect(rich).toContain('Commands\n  init                  Set up this repo\n')
    expect(rich).toContain('Run pawl <command> --help for the options of a command.')
    expect(rich).not.toContain('--max-warnings')
  })

  it("shows one command's usage, options and examples", () => {
    const text = helpText('init')

    expect(text).toContain('  pawl init  Set up this repo\n')
    expect(text).toContain('  --agents ')
    expect(text).toContain('  $ pawl init --yes --agents --hooks\n')
    expect(text).not.toContain('--max-warnings')
  })

  it('says what was probably meant', () => {
    expect(unknownCommand('fxi').message).toBe('Unknown command "fxi". Did you mean "pawl fix"? Run "pawl --help".')
    expect(unknownCommand('lint').message).toBe('Unknown command "lint". Run "pawl --help".')

    const unknown = Object.assign(new TypeError("Unknown option '--dry-rnu'"), {
      code: 'ERR_PARSE_ARGS_UNKNOWN_OPTION'
    })

    expect((usageFrom(unknown) as Error).message).toBe(
      'Unknown option "--dry-rnu". Did you mean "--dry-run"? Run "pawl --help" for the options.'
    )

    const other = new Error('boom')

    expect(usageFrom(other)).toBe(other)
  })
})

describe('the rows of the doctor', () => {
  it('marks each part as fine, worth a look, broken or just so', () => {
    const report: DoctorReport = {
      version: '1.0.0',
      project: {
        summary: 'TypeScript, pnpm',
        packageManager: 'pnpm',
        typescript: true,
        frameworks: [],
        runtimes: ['node'],
        formats: [],
        packages: 0
      },
      policy: { file: undefined, sources: ['pawl'], strict: false, maxWarnings: undefined },
      linter: 'biome',
      formatter: 'biome',
      engines: {
        biome: { installed: true, config: 'biome.json', status: 'stale' },
        eslint: { installed: false, activePacks: [], availablePacks: ['react'], notEnforced: [] }
      },
      compatibility: [{ name: 'node', wanted: '>=22.18.0', installed: '22.0.0', ok: false }],
      languages: [],
      suggestedPacks: [],
      guards: [],
      guardsImportsOnly: false,
      limitations: [],
      lintTraversal: { commands: [], overlaps: [], unknown: [] },
      taskReachability: { complete: false, tasks: [], files: [], issues: [] },
      baseline: { missing: 'none' },
      problems: []
    }
    const states = Object.fromEntries(doctorRows(report).map(row => [row.label || `+ ${row.value}`, row.state]))

    expect(states).toMatchObject({
      Project: 'info',
      Node: 'warn',
      Biome: 'warn',
      ESLint: 'error',
      Packs: 'info',
      Baseline: 'info'
    })
  })
})
