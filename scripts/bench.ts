// The benchmarks on pawl.santi020k.com/guide/benchmarks/, measured on a copy of pawl's own source.
//
//   node scripts/bench.ts             measure and print the table
//   node scripts/bench.ts --write     also write apps/docs/src/data/benchmarks.json, which the page reads
//   node scripts/bench.ts --runs 20   more runs per case (default 10)
//
// It needs the built package: run "pnpm --filter @santi020k/pawl run build" first. Each case runs
// once to warm the file cache, then the given number of times; the page shows the median, the
// fastest and the slowest run. What it measures:
//
//   - the overhead of pawl: `pawl check` against the engine command pawl itself runs, with the same
//     config, on the same files;
//   - one standard on each engine: `pawl check` with Biome, Oxlint and ESLint linting;
//   - the edit hook: `pawl fix --hook` on the one file a coding agent edited.
import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { cpus, platform, release, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const pawl = join(root, 'packages/pawl')
const cli = join(pawl, 'dist/cli.js')

export interface Case {
  id: string
  label: string
  /** Milliseconds of every measured run. */
  runs: number[]
}

export interface Result {
  id: string
  label: string
  medianMs: number
  minMs: number
  maxMs: number
}

export interface Benchmarks {
  date: string
  machine: { cpu: string; cores: number; os: string }
  node: string
  versions: Record<string, string>
  corpus: { description: string; files: number; lines: number }
  runs: number
  results: Result[]
}

export const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)

  return sorted.length % 2 === 0 ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2 : (sorted[middle] ?? 0)
}

export const summarize = (item: Case): Result => ({
  id: item.id,
  label: item.label,
  medianMs: Math.round(median(item.runs)),
  minMs: Math.round(Math.min(...item.runs)),
  maxMs: Math.round(Math.max(...item.runs))
})

/** The table the script prints, in the shape the page shows it. */
export const table = (results: readonly Result[]): string =>
  [
    '| Case | Median | Fastest | Slowest |',
    '| ---- | -----: | ------: | ------: |',
    ...results.map(result => `| ${result.label} | ${result.medianMs} ms | ${result.minMs} ms | ${result.maxMs} ms |`)
  ].join('\n')

const ENV = { ...process.env, CI: '', GITHUB_ACTIONS: '', NO_COLOR: '1', PAWL_AGENT: '0', PAWL_FORMAT: '' }

const time = (cwd: string, command: string, args: readonly string[], input?: string): number => {
  const started = performance.now()
  const result = spawnSync(command, args, { cwd, env: ENV, encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024 })
  const elapsed = performance.now() - started

  // 0 is clean and 1 is findings: both are a check that ran. Anything else is not a measurement.
  if (result.status !== 0 && result.status !== 1)
    throw new Error(`${command} ${args.join(' ')} exited with ${result.status}:\n${result.stdout}\n${result.stderr}`)

  return elapsed
}

const measure = (id: string, label: string, runs: number, run: () => number): Case => {
  run()

  return { id, label, runs: Array.from({ length: runs }, run) }
}

/**
 * The packages a project needs for each engine, linked from the workspace's own: pawl's dev
 * dependencies, and typescript-eslint from the ESLint fixtures. Pawl finds `@eslint/js` where
 * ESLint is installed.
 */
const LINKED = ['@biomejs/biome', 'oxlint', 'oxlint-tsgolint', 'eslint', 'typescript-eslint', 'typescript', 'prettier']

const WHERE = [join(pawl, 'node_modules'), join(pawl, 'test/fixtures/eslint/node_modules'), join(root, 'node_modules')]

const installed = (name: string): string => {
  const found = WHERE.map(dir => join(dir, name)).find(dir => existsSync(join(dir, 'package.json')))

  if (!found) throw new Error(`${name} is not installed in the workspace. Run "pnpm install".`)

  return found
}

const manifest = (name: string): { version: string; bin?: string | Record<string, string> } =>
  JSON.parse(readFileSync(join(installed(name), 'package.json'), 'utf8')) as {
    version: string
    bin?: string | Record<string, string>
  }

const version = (name: string): string => manifest(name).version

/** The program of an engine command, from the package that ships it. */
const PROGRAMS: Record<string, string> = { biome: '@biomejs/biome', oxlint: 'oxlint', eslint: 'eslint' }

const binOf = (program: string): string => {
  const name = PROGRAMS[program]

  if (!name) throw new Error(`No package ships "${program}"`)

  const { bin } = manifest(name)
  const entry = typeof bin === 'string' ? bin : bin?.[program]

  if (!entry) throw new Error(`${name} has no "${program}" program`)

  return join(installed(name), entry)
}

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap(name => {
    const path = join(dir, name)

    if (statSync(path).isDirectory()) return sourceFiles(path)

    return name.endsWith('.ts') ? [path] : []
  })

/** A project with a copy of pawl's source and tests, set up for one engine. */
const corpus = (engine: string): string => {
  const project = mkdtempSync(join(tmpdir(), `pawl-bench-${engine}-`))

  cpSync(join(pawl, 'src'), join(project, 'src'), { recursive: true })
  cpSync(join(pawl, 'test'), join(project, 'test'), {
    recursive: true,
    filter: source => !source.includes(`${join('test', 'fixtures')}`)
  })
  writeFileSync(
    join(project, 'package.json'),
    `${JSON.stringify({ name: 'bench', private: true, type: 'module', devDependencies: {} }, null, 2)}\n`
  )
  writeFileSync(
    join(project, 'tsconfig.json'),
    `${JSON.stringify({ compilerOptions: { strict: true, module: 'nodenext', target: 'es2024', noEmit: true, allowImportingTsExtensions: true }, include: ['src', 'test'] }, null, 2)}\n`
  )

  for (const [name, target] of [['@santi020k/pawl', pawl], ...LINKED.map(name => [name, installed(name)])]) {
    const link = join(project, 'node_modules', name as string)

    mkdirSync(dirname(link), { recursive: true })
    symlinkSync(target as string, link, 'junction')
  }

  spawnSync('git', ['init', '-q'], { cwd: project })

  const init = spawnSync(
    process.execPath,
    [cli, 'init', '--yes', '--no-install', '--no-editor', '--no-baseline', '--engine', engine, '--formatter', 'biome'],
    { cwd: project, env: ENV, encoding: 'utf8' }
  )

  if (init.status !== 0) throw new Error(`pawl init --engine ${engine} failed:\n${init.stdout}\n${init.stderr}`)

  return project
}

/** The engine command `pawl check --verbose` says it ran, to time the engine on its own. */
const engineCommand = (project: string): [string, string[]] => {
  const result = spawnSync(process.execPath, [cli, 'check', '--format', 'json', '--verbose'], {
    cwd: project,
    env: ENV,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  })
  const report = JSON.parse(result.stdout) as { commands?: string[] }
  const [command] = report.commands ?? []

  if (!command) throw new Error('pawl check --verbose named no engine command')

  // "biome check ." as a person would type it, run with the program the package ships.
  const [program = '', ...args] = command.split(' ')

  return [binOf(program), args]
}

const main = (): void => {
  const flags = process.argv.slice(2)
  const runsFlag = flags.indexOf('--runs')
  const runs = runsFlag >= 0 ? Number(flags[runsFlag + 1]) : 10

  if (!Number.isInteger(runs) || runs < 3) throw new Error('--runs takes a whole number of at least 3')

  const projects = { biome: corpus('biome'), oxlint: corpus('oxlint'), eslint: corpus('eslint') }
  const files = sourceFiles(join(projects.biome, 'src')).concat(sourceFiles(join(projects.biome, 'test')))
  const lines = files.reduce((sum, file) => sum + readFileSync(file, 'utf8').split('\n').length, 0)
  const [program, args] = engineCommand(projects.biome)
  const edited = join(projects.biome, 'src/check/output.ts')
  const payload = JSON.stringify({
    hook_event_name: 'PostToolUse',
    session_id: 'bench',
    tool_name: 'Edit',
    tool_input: { file_path: edited }
  })
  const pawlCheck = (project: string) => () => time(project, process.execPath, [cli, 'check'])
  const cases = [
    measure('biome-alone', 'Biome alone, with the config pawl writes', runs, () => time(projects.biome, program, args)),
    measure('pawl-biome', 'pawl check, Biome', runs, pawlCheck(projects.biome)),
    measure('pawl-oxlint', 'pawl check, Oxlint (Biome formats)', runs, pawlCheck(projects.oxlint)),
    measure('pawl-eslint', 'pawl check, ESLint (Biome formats)', runs, pawlCheck(projects.eslint)),
    measure('hook', 'pawl fix --hook, one edited file', runs, () =>
      time(projects.biome, process.execPath, [cli, 'fix', '--hook'], payload)
    )
  ]
  const results = cases.map(summarize)
  const benchmarks: Benchmarks = {
    date: new Date().toISOString().slice(0, 10),
    machine: { cpu: cpus()[0]?.model.trim() ?? 'unknown', cores: cpus().length, os: `${platform()} ${release()}` },
    node: process.versions.node,
    versions: {
      pawl: (JSON.parse(readFileSync(join(pawl, 'package.json'), 'utf8')) as { version: string }).version,
      biome: version('@biomejs/biome'),
      oxlint: version('oxlint'),
      eslint: version('eslint')
    },
    corpus: { description: "pawl's own source and tests", files: files.length, lines },
    runs,
    results
  }

  process.stdout.write(
    `${benchmarks.corpus.files} files, ${benchmarks.corpus.lines} lines, ${runs} runs each, Node ${benchmarks.node}, ${benchmarks.machine.cpu} (${benchmarks.machine.cores} cores)\n\n${table(results)}\n`
  )

  if (flags.includes('--write')) {
    writeFileSync(join(root, 'apps/docs/src/data/benchmarks.json'), `${JSON.stringify(benchmarks, null, 2)}\n`)
    process.stdout.write('\nWrote apps/docs/src/data/benchmarks.json\n')
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
