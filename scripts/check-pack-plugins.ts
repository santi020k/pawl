// Runs every pack against the real plugin it names, in a new project, as a user would: install the
// plugins, switch every pack on, and check one file of each kind the packs read. A pack whose
// plugin lacks the preset or a rule the pack names, or whose plugin crashes, is a setup problem
// and fails the run. Findings are fine: the files are not meant to be clean.
//
//   node scripts/check-pack-plugins.ts floor    each plugin at the oldest version its range allows
//   node scripts/check-pack-plugins.ts latest   each plugin at its newest version
//
// Needs the built package: run "pnpm --filter @santi020k/pawl run build" first. It installs with
// npm from the registry, so it is for the weekly canary and for a person checking a range, not for
// `pnpm ok`.
import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PACKS, type Pack } from '../packages/pawl/src/catalog/packs.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const pawl = join(root, 'packages/pawl')

export type Versions = 'floor' | 'latest'

/** The version of a plugin to install: the floor of its `>=` range, or the newest. */
export const pluginVersion = (range: string, versions: Versions): string => {
  if (versions === 'latest') return 'latest'

  const floor = /^>=\s*(\d+\.\d+\.\d+)$/.exec(range.trim())?.[1]

  if (!floor) throw new Error(`The range "${range}" has no floor to install`)

  return floor
}

/**
 * The packages the project installs: ESLint, TypeScript ESLint and every pack's plugin. The peers
 * the plugins declare come on top, from `peersOf`, as npm would install them.
 */
export const projectDependencies = (
  packs: readonly Pack[],
  peers: Readonly<Record<string, string>>,
  versions: Versions
): Record<string, string> => {
  const dependencies: Record<string, string> = {
    eslint: pluginVersion(peers.eslint ?? '>=9.22.0', versions),
    'typescript-eslint': pluginVersion(peers['typescript-eslint'] ?? '>=8.0.0', versions),
    typescript: versions === 'floor' ? '~5.9.0' : '^6.0.0',
    // What some plugins load at run time without declaring them as required peers.
    svelte: '^5.0.0',
    tailwindcss: '^4.0.0',
    graphql: '^16.0.0',
    jest: versions === 'floor' ? '^29.0.0' : 'latest',
    // Prettier formats, so the perfectionist pack's import sorting does not compete with Biome's.
    prettier: pluginVersion(peers.prettier ?? '>=3.0.0', versions)
  }

  for (const pack of packs) {
    if (pack.plugin === 'eslint') continue

    dependencies[pack.plugin] ??= pluginVersion(pack.range, versions)
  }

  return dependencies
}

/** A package's required peers, from its registry document, without the optional ones. */
export const requiredPeers = (manifest: {
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
}): Record<string, string> =>
  Object.fromEntries(
    Object.entries(manifest.peerDependencies ?? {}).filter(
      ([name]) => manifest.peerDependenciesMeta?.[name]?.optional !== true
    )
  )

/** The required peers of every plugin at the version the run installs, which the run adds when missing. */
const peersOf = async (dependencies: Readonly<Record<string, string>>): Promise<Record<string, string>> => {
  const added: Record<string, string> = {}

  for (const [name, version] of Object.entries(dependencies)) {
    // Ranges are the packages the run adds for itself, such as TypeScript; only plugins are looked up.
    if (version !== 'latest' && !/^\d+\.\d+\.\d+$/.test(version)) continue

    const response = await fetch(`https://registry.npmjs.org/${name.replaceAll('/', '%2f')}`)

    if (!response.ok) throw new Error(`The registry answered ${response.status} for ${name}`)

    const document = (await response.json()) as {
      'dist-tags': Record<string, string>
      versions: Record<string, Parameters<typeof requiredPeers>[0]>
    }
    const manifest = document.versions[version === 'latest' ? (document['dist-tags'].latest ?? '') : version]

    if (!manifest) throw new Error(`${name} has no version ${version}`)

    for (const [peer, range] of Object.entries(requiredPeers(manifest)))
      if (!(peer in dependencies) && !(peer in added)) added[peer] = range
  }

  return added
}

/** One file of each kind a pack reads. They have problems on purpose. */
const FILES: Record<string, string> = {
  'tsconfig.json': `${JSON.stringify({ compilerOptions: { strict: true, jsx: 'preserve', module: 'esnext', moduleResolution: 'bundler', target: 'es2022', experimentalDecorators: true }, include: ['src'] }, null, 2)}\n`,
  'src/index.ts': 'export const add = (a: number, b: number) => a + b\nconsole.log(add(1, 2))\n',
  'src/app.tsx': 'export const App = () => <button onClick={() => fetch("/")}>go</button>\n',
  'src/index.test.ts':
    "import { expect, test } from 'vitest'\nimport { add } from './index.ts'\n\ntest('adds', () => {\n  expect(add(1, 2)).toBe(3)\n})\n",
  'src/App.vue':
    '<template>\n  <div v-if="show">{{ message }}</div>\n</template>\n\n<script setup lang="ts">\nconst show = true\nconst message = "hi"\n</script>\n',
  'src/App.svelte':
    '<script lang="ts">\n  let count = 0\n</script>\n\n<button on:click={() => count++}>{count}</button>\n',
  'src/page.astro': '---\nconst title = "Hi"\n---\n\n<h1>{title}</h1>\n',
  'src/query.graphql': 'query Todos {\n  todos {\n    id\n  }\n}\n',
  'schema.graphql': 'type Query {\n  todos: [Todo]\n}\n\ntype Todo {\n  id: ID\n}\n',
  'config.yml': 'name: example\nlist:\n  - one\n  - two\n',
  'data.json': '{ "a": 1, "b": [1, 2] }\n',
  'settings.toml': 'name = "example"\nvalue  =  1\n',
  'index.html':
    '<!doctype html>\n<html lang="en">\n  <body>\n    <button style="color: red">go</button>\n  </body>\n</html>\n',
  'README.md': '# Example\n\nSome text.\n',
  // eslint-plugin-pnpm reads the workspace file, and @graphql-eslint the GraphQL config: each stops without one.
  'pnpm-workspace.yaml': 'packages: []\n',
  '.graphqlrc.yml': 'schema: schema.graphql\ndocuments: src/**/*.graphql\n'
}

const run = (
  cwd: string,
  command: string,
  args: string[]
): { status: number | null; stdout: string; stderr: string } => {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, CI: '', GITHUB_ACTIONS: '', NO_COLOR: '1', PAWL_AGENT: '0', PAWL_FORMAT: '' },
    maxBuffer: 64 * 1024 * 1024,
    shell: process.platform === 'win32'
  })

  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

interface Report {
  setup?: { code: string; message: string; fix?: string }[]
  findings?: { rule: string }[]
}

const main = async (): Promise<void> => {
  const versions = process.argv[2] as Versions

  if (versions !== 'floor' && versions !== 'latest') throw new Error('Say "floor" or "latest".')

  const cli = join(pawl, 'dist/cli.js')

  if (!existsSync(cli)) throw new Error('Build the package first: pnpm --filter @santi020k/pawl run build')

  const { PEER_RANGES } = await import('../packages/pawl/src/version.ts')
  const plugins = projectDependencies(PACKS, PEER_RANGES, versions)
  const dependencies = { ...plugins, ...(await peersOf(plugins)) }
  const project = mkdtempSync(join(tmpdir(), `pawl-packs-${versions}-`))

  writeFileSync(
    join(project, 'package.json'),
    `${JSON.stringify({ name: 'pawl-packs', private: true, type: 'module', devDependencies: dependencies }, null, 2)}\n`
  )

  for (const [file, content] of Object.entries(FILES)) {
    mkdirSync(dirname(join(project, file)), { recursive: true })
    writeFileSync(join(project, file), content)
  }

  process.stdout.write(`Installing ${Object.keys(dependencies).length} packages (${versions}) in ${project}\n`)

  // The peers are in the list already. --legacy-peer-deps keeps npm from refusing the install where
  // the plugins' own peer ranges disagree, as they do in projects.
  const install = run(project, 'npm', ['install', '--no-audit', '--no-fund', '--ignore-scripts', '--legacy-peer-deps'])

  if (install.status !== 0) throw new Error(`npm install failed:\n${install.stderr}`)

  mkdirSync(join(project, 'node_modules/@santi020k'), { recursive: true })
  symlinkSync(pawl, join(project, 'node_modules/@santi020k/pawl'), 'junction')
  writeFileSync(
    join(project, 'pawl.config.json'),
    `${JSON.stringify({ engine: 'eslint', formatter: 'prettier', packs: [...new Set(PACKS.map(pack => pack.name))] }, null, 2)}\n`
  )

  const init = run(project, process.execPath, [cli, 'init', '--yes', '--no-install', '--no-editor', '--no-baseline'])

  if (init.status !== 0) throw new Error(`pawl init failed:\n${init.stdout}\n${init.stderr}`)

  // Init leaves the policy it found alone; sync writes what that policy asks for.
  const sync = run(project, process.execPath, [cli, 'sync', '--yes'])

  if (sync.status !== 0) throw new Error(`pawl sync failed:\n${sync.stdout}\n${sync.stderr}`)

  const check = run(project, process.execPath, [cli, 'check', '--format', 'json'])
  let report: Report

  try {
    report = JSON.parse(check.stdout) as Report
  } catch (error) {
    throw new Error(`pawl check printed no report (exit ${check.status}):\n${check.stdout}\n${check.stderr}`, {
      cause: error
    })
  }

  const setup = report.setup ?? []
  const rules = new Set((report.findings ?? []).map(finding => finding.rule.split('/')[0]))
  const lines = [
    `### Pack plugins: ${versions}`,
    '',
    `${PACKS.length} packs, exit code ${check.status}, ${report.findings?.length ?? 0} findings from ${rules.size} rule namespaces.`,
    '',
    ...(setup.length === 0
      ? ['No setup problems: every plugin loaded with its preset and rules.']
      : setup.map(issue => `- \`${issue.code}\`: ${issue.message}${issue.fix ? ` ${issue.fix}` : ''}`))
  ]
  const summary = `${lines.join('\n')}\n`

  process.stdout.write(summary)

  // GitHub Actions shows what is written to this file on the run's page. Not a task input.
  const { GITHUB_STEP_SUMMARY: stepSummary } = process.env

  if (stepSummary) appendFileSync(stepSummary, `${summary}\n`)

  if (check.status === 2 || setup.length > 0) process.exitCode = 1
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
