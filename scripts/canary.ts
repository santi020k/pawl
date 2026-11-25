// What the weekly engine canary changes before it builds and tests: one group of the tools pawl
// pins, moved to their newest versions, as a maintainer would to upgrade them. The canary then
// regenerates the generated files and runs the tests, so a failure means "this upgrade needs work".
//
//   node scripts/canary.ts <group>   biome, oxlint, eslint or prettier
//
// It picks the newest version that is at least a day old, as pnpm's minimumReleaseAge would, and
// writes a summary of what it moved to $GITHUB_STEP_SUMMARY when that is set.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))

/** What one group moves: catalog entries, devDependencies of the ESLint fixtures, and pins in the source. */
interface Group {
  catalog: string[]
  fixtures?: string[]
  /** Exact pins pawl declares for the package: its peer range and the constant pawl checks it against. */
  exact?: { name: string; file: string; pattern: RegExp }[]
}

export const GROUPS: Record<string, Group> = {
  biome: {
    catalog: ['@biomejs/biome'],
    exact: [
      { name: '@biomejs/biome', file: 'packages/pawl/package.json', pattern: /("@biomejs\/biome": ")(\d[^"]*)(")/ },
      {
        name: '@biomejs/biome',
        file: 'packages/pawl/src/engines/biome/config.ts',
        pattern: /(export const BIOME_VERSION = ')([^']+)(')/
      }
    ]
  },
  oxlint: { catalog: ['oxlint', 'oxlint-tsgolint'] },
  eslint: {
    catalog: ['eslint'],
    fixtures: [
      '@vitest/eslint-plugin',
      'eslint-import-resolver-typescript',
      'eslint-plugin-astro',
      'eslint-plugin-import-x',
      'eslint-plugin-playwright',
      'typescript-eslint'
    ]
  },
  prettier: { catalog: ['prettier'] }
}

const DAY = 24 * 60 * 60 * 1000

/** The highest stable version published at least `minAge` before `now`, from a registry document's `time`. */
export const newestSettled = (time: Readonly<Record<string, string>>, now: number, minAge = DAY): string | undefined =>
  Object.entries(time)
    .filter(([version]) => /^\d+\.\d+\.\d+$/.test(version))
    .filter(([, published]) => now - Date.parse(published) >= minAge)
    .map(([version]) => version)
    .sort((a, b) => compare(b, a))[0]

const compare = (a: string, b: string): number => {
  const [x, y] = [a, b].map(version => version.split('.').map(Number))

  for (let index = 0; index < 3; index++) {
    const difference = (x?.[index] ?? 0) - (y?.[index] ?? 0)

    if (difference !== 0) return difference
  }

  return 0
}

/** The higher of two versions, so the canary never moves a tool back. */
export const higher = (a: string, b: string): string => (compare(a, b) >= 0 ? a : b)

/** The version a catalog entry names now, without its range operator. */
export const catalogVersion = (yaml: string, name: string): string | undefined => {
  const key = name.startsWith('@') ? `"${name}"` : name

  return new RegExp(`^  ${key.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}: [~^]?(\\S+)$`, 'm').exec(yaml)?.[1]
}

/**
 * A catalog entry of pnpm-workspace.yaml set to a version, keeping its range operator: `^1.0.0`
 * stays a caret range and an exact pin stays exact. Undefined when the catalog has no such entry.
 */
export const setCatalogEntry = (yaml: string, name: string, version: string): string | undefined => {
  const key = name.startsWith('@') ? `"${name}"` : name
  const line = new RegExp(`^(  ${key.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}: )([~^]?)(\\S+)$`, 'm')

  if (!line.test(yaml)) return undefined

  return yaml.replace(line, (_match, start: string, operator: string) => `${start}${operator}${version}`)
}

const latest = async (name: string): Promise<string> => {
  const response = await fetch(`https://registry.npmjs.org/${name.replaceAll('/', '%2f')}`)

  if (!response.ok) throw new Error(`The registry answered ${response.status} for ${name}`)

  const document = (await response.json()) as { time?: Record<string, string> }
  const version = newestSettled(document.time ?? {}, Date.now())

  if (!version) throw new Error(`${name} has no stable version older than a day`)

  return version
}

const main = async (): Promise<void> => {
  const name = process.argv[2] ?? ''
  const group = GROUPS[name]

  if (!group) throw new Error(`Name a group: ${Object.keys(GROUPS).join(', ')}`)

  const moved: string[] = []
  const workspacePath = join(root, 'pnpm-workspace.yaml')
  let workspace = readFileSync(workspacePath, 'utf8')

  for (const pkg of group.catalog) {
    const version = higher(await latest(pkg), catalogVersion(workspace, pkg) ?? '0.0.0')
    const next = setCatalogEntry(workspace, pkg, version)

    if (next === undefined) throw new Error(`pnpm-workspace.yaml has no catalog entry for ${pkg}`)

    workspace = next
    moved.push(`${pkg} ${version}`)
  }

  writeFileSync(workspacePath, workspace)

  if (group.fixtures) {
    const path = join(root, 'packages/pawl/test/fixtures/eslint/package.json')
    const manifest = JSON.parse(readFileSync(path, 'utf8')) as { devDependencies: Record<string, string> }

    for (const pkg of group.fixtures) {
      const version = higher(await latest(pkg), manifest.devDependencies[pkg] ?? '0.0.0')

      manifest.devDependencies[pkg] = version
      moved.push(`${pkg} ${version} (ESLint fixtures)`)
    }

    writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`)
  }

  for (const pin of group.exact ?? []) {
    const path = join(root, pin.file)
    const text = readFileSync(path, 'utf8')
    const current = pin.pattern.exec(text)?.[2]

    if (current === undefined) throw new Error(`${pin.file} has no pin for ${pin.name}`)

    const version = higher(await latest(pin.name), current)

    writeFileSync(path, text.replace(pin.pattern, `$1${version}$3`))
  }

  const summary = `### Engine canary: ${name}\n\n${moved.map(line => `- ${line}`).join('\n')}\n`

  process.stdout.write(summary)

  // GitHub Actions shows what is written to this file on the run's page. Not a task input.
  const { GITHUB_STEP_SUMMARY: stepSummary } = process.env

  if (stepSummary) appendFileSync(stepSummary, `${summary}\n`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
