// The release steps that CI and the release workflow run. A release is prepared on a
// `release/v<version>` branch, merged into `main` through a pull request and published from there.
//
//   node scripts/release.ts check [branch] the release branch is ready to merge
//   node scripts/release.ts guard [base]   a branch that is not a release leaves the versions alone
//   node scripts/release.ts plan           what the release workflow has to do, as step outputs
//   node scripts/release.ts publish        publish every package version npm does not have yet
//   node scripts/release.ts verify         the published packages install and run
//   node scripts/release.ts notes <file>   write the release notes from the changelogs
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface ReleasePackage {
  name: string
  version: string
  dir: string
  changelog: string
}

/** What npm knows about one version of a package. */
export type NpmState = 'published' | 'unpublished' | 'unknown-package'

export interface SourceInput {
  branch: string
  packages: ReleasePackage[]
  pendingChangesets: string[]
  npmState: (pkg: ReleasePackage) => NpmState
  tagExists: (tag: string) => boolean
}

const root = fileURLToPath(new URL('..', import.meta.url))
const semver = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
const branchPrefix = 'release/v'

/** The version a release branch names, or undefined when the name is not `release/v<semver>`. */
export const releaseBranchVersion = (branch: string): string | undefined => {
  if (!branch.startsWith(branchPrefix)) return undefined
  const version = branch.slice(branchPrefix.length)
  return semver.test(version) ? version : undefined
}

/** The body of one version's section in a changelog written by Changesets, or undefined without one. */
export const changelogSection = (changelog: string, version: string): string | undefined => {
  const lines = changelog.split('\n')
  const start = lines.findIndex(line => line.trim() === `## ${version}`)
  if (start === -1) return undefined
  const rest = lines.slice(start + 1)
  const end = rest.findIndex(line => line.startsWith('## '))
  return (end === -1 ? rest : rest.slice(0, end)).join('\n').trim()
}

/** What `npm view <name> versions --json` said: every version of the package, or E404 for none. */
export const npmStateFrom = (status: number | null, stdout: string, stderr: string, version: string): NpmState => {
  if (status === 0) {
    const versions: unknown = JSON.parse(stdout)
    if (!Array.isArray(versions)) throw new Error(`npm did not list the versions: ${stdout.trim()}`)
    return versions.includes(version) ? 'published' : 'unpublished'
  }
  if (/\bE404\b/.test(`${stderr}\n${stdout}`)) return 'unknown-package'
  throw new Error(`npm did not answer for version ${version}:\n${stderr.trim()}`)
}

/** Every reason the tree is not a prepared release of one version. Empty when it is. */
export const contentProblems = (packages: ReleasePackage[], version: string, pendingChangesets: string[]): string[] => {
  const problems: string[] = []
  if (packages.length === 0) problems.push('No publishable package was found under packages/.')
  for (const pkg of packages) {
    if (pkg.version !== version) {
      problems.push(`${pkg.name} is at ${pkg.version}, but the release is ${version}. Run \`pnpm version-packages\`.`)
    } else if (changelogSection(pkg.changelog, version) === undefined) {
      problems.push(`${pkg.dir}/CHANGELOG.md has no entry for ${version}. Run \`pnpm version-packages\`.`)
    }
  }
  if (pendingChangesets.length > 0) {
    problems.push(
      `Changesets are still pending: ${pendingChangesets.join(', ')}. Run \`pnpm version-packages\` and commit the result.`
    )
  }
  return problems
}

/** Every reason the release branch is not ready to merge. Empty when it is. */
export const sourceProblems = (input: SourceInput): string[] => {
  const version = releaseBranchVersion(input.branch)
  if (!version) {
    return [
      `The branch "${input.branch}" is not a release branch. Name it release/v<version>, for example release/v1.2.0.`
    ]
  }
  const problems = contentProblems(input.packages, version, input.pendingChangesets)
  for (const pkg of input.packages) {
    if (pkg.version === version && input.npmState(pkg) === 'published') {
      problems.push(
        `${pkg.name}@${version} is already on npm. A published version cannot be released again; bump the version.`
      )
    }
  }
  if (input.tagExists(`v${version}`))
    problems.push(`The tag v${version} already exists. Release a new version instead.`)
  return problems
}

/** The packages whose version differs from the base branch. Only a release branch may change one. */
export const versionChanges = (
  packages: ReleasePackage[],
  baseVersion: (pkg: ReleasePackage) => string | undefined
): string[] =>
  packages.flatMap(pkg => {
    const base = baseVersion(pkg)
    return base === undefined || base === pkg.version
      ? []
      : [
          `${pkg.name} goes from ${base} to ${pkg.version}. Versions change only on a release/v<version> branch; add a changeset instead.`
        ]
  })

/** The packages npm has never seen. Trusted publishing cannot create a package, so these stop a release. */
export const firstPublishProblem = (unknown: string[]): string | undefined =>
  unknown.length === 0
    ? undefined
    : `${unknown.join(' and ')} ${unknown.length === 1 ? 'is' : 'are'} not on npm yet. npm trusted publishing needs the package to exist: ` +
      'publish a 0.0.0 placeholder by hand, add release.yml as its trusted publisher, then re-run the failed jobs of this run. See CONTRIBUTING.md.'

/** The release notes: each package's changelog entry for its version. */
export const releaseNotes = (packages: ReleasePackage[]): string =>
  packages
    .map(
      pkg =>
        `## ${pkg.name}@${pkg.version}\n\n${changelogSection(pkg.changelog, pkg.version) || 'No changes recorded.'}`
    )
    .join('\n\n')

const manifestField = (manifest: string, key: string): unknown => {
  const parsed: unknown = JSON.parse(manifest)
  return typeof parsed === 'object' && parsed !== null ? Reflect.get(parsed, key) : undefined
}

const readPackages = (): ReleasePackage[] => {
  const packagesDir = join(root, 'packages')
  const found: ReleasePackage[] = []
  for (const entry of readdirSync(packagesDir).sort()) {
    const manifestPath = join(packagesDir, entry, 'package.json')
    if (!existsSync(manifestPath)) continue
    const manifest = readFileSync(manifestPath, 'utf8')
    const name = manifestField(manifest, 'name')
    const version = manifestField(manifest, 'version')
    if (manifestField(manifest, 'private') === true || typeof name !== 'string' || typeof version !== 'string') continue
    const changelogPath = join(packagesDir, entry, 'CHANGELOG.md')
    found.push({
      name,
      version,
      dir: `packages/${entry}`,
      changelog: existsSync(changelogPath) ? readFileSync(changelogPath, 'utf8') : ''
    })
  }
  // The library goes first: the other packages depend on it.
  return found.sort((a, b) => Number(b.name === '@santi020k/pawl') - Number(a.name === '@santi020k/pawl'))
}

const pendingChangesets = (): string[] =>
  readdirSync(join(root, '.changeset')).filter(name => name.endsWith('.md') && name !== 'README.md')

const run = (command: string, args: string[], cwd = root, env = process.env): string =>
  execFileSync(command, args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim()

const npmState = (pkg: ReleasePackage): NpmState => {
  const result = spawnSync('npm', ['view', pkg.name, 'versions', '--json'], { cwd: root, encoding: 'utf8' })
  if (result.error) throw result.error
  return npmStateFrom(result.status, result.stdout, result.stderr, pkg.version)
}

const tagExists = (tag: string): boolean => run('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`]) !== ''

const say = (message: string): void => {
  process.stdout.write(`${message}\n`)
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

const check = (branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD'])): void => {
  const problems = sourceProblems({
    branch,
    packages: readPackages(),
    pendingChangesets: pendingChangesets(),
    npmState,
    tagExists
  })
  if (problems.length > 0)
    throw new Error(`The release branch is not ready:\n${problems.map(problem => `- ${problem}`).join('\n')}`)
  say(`${branch} is ready to merge.`)
}

const guard = (base = 'origin/main'): void => {
  const baseVersion = (pkg: ReleasePackage): string | undefined => {
    const shown = spawnSync('git', ['show', `${base}:${pkg.dir}/package.json`], { cwd: root, encoding: 'utf8' })
    // The package is new on this branch when the base does not have it.
    if (shown.status !== 0) return undefined
    const version = manifestField(shown.stdout, 'version')
    return typeof version === 'string' ? version : undefined
  }
  run('git', ['rev-parse', '--verify', '--quiet', `${base}^{commit}`])
  const problems = versionChanges(readPackages(), baseVersion)
  if (problems.length > 0) throw new Error(problems.map(problem => `- ${problem}`).join('\n'))
  say(`No package version differs from ${base}.`)
}

const packageStates = (packages: ReleasePackage[]): { pkg: ReleasePackage; state: NpmState }[] => {
  const states = packages.map(pkg => ({ pkg, state: npmState(pkg) }))
  const problem = firstPublishProblem(
    states.filter(({ state }) => state === 'unknown-package').map(({ pkg }) => pkg.name)
  )
  if (problem) throw new Error(problem)
  return states
}

const plan = (): void => {
  const packages = readPackages()
  const version = packages[0]?.version
  if (!version) throw new Error('No publishable package was found under packages/.')
  const publish = packageStates(packages).some(({ state }) => state !== 'published')
  // A version that is not released yet must be a prepared release: a commit that lands on main
  // after a failed release run must not be published in its place.
  if (publish || !tagExists(`v${version}`)) {
    const problems = contentProblems(packages, version, pendingChangesets())
    if (problems.length > 0) {
      throw new Error(
        `${version} is not released, and this commit is not a prepared release. Re-run the failed jobs of the release commit's run instead.\n` +
          problems.map(problem => `- ${problem}`).join('\n')
      )
    }
  }
  // The workflow appends these lines to GITHUB_OUTPUT.
  say(`version=${version}`)
  say(`publish=${publish}`)
}

const publish = (): void => {
  const states = packageStates(readPackages())
  // Publish with npm's trusted publishing only: a stored token must never be the credential.
  const { NODE_AUTH_TOKEN: _nodeAuthToken, NPM_TOKEN: _npmToken, ...env } = process.env
  const work = mkdtempSync(join(tmpdir(), 'pawl-release-'))
  try {
    for (const { pkg, state } of states) {
      if (state === 'published') {
        say(`${pkg.name}@${pkg.version} is already on npm.`)
        continue
      }
      const destination = join(work, pkg.dir.replaceAll('/', '-'))
      mkdirSync(destination)
      // pnpm writes the real versions in place of `workspace:` and `catalog:`.
      run('pnpm', ['--filter', pkg.name, 'pack', '--pack-destination', destination])
      const tarball = readdirSync(destination).find(name => name.endsWith('.tgz'))
      if (!tarball) throw new Error(`pnpm pack did not produce a tarball for ${pkg.name}`)
      const tag = pkg.version.includes('-') ? ['--tag', 'next'] : []
      run('npm', ['publish', join(destination, tarball), '--access', 'public', '--provenance', ...tag], root, env)
      say(`Published ${pkg.name}@${pkg.version}.`)
    }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

const verify = async (): Promise<void> => {
  const packages = readPackages()
  // The registry can take a moment to serve a version it has just accepted.
  for (const pkg of packages) {
    let state = npmState(pkg)
    for (let attempt = 1; state !== 'published' && attempt < 30; attempt += 1) {
      await sleep(10_000)
      state = npmState(pkg)
    }
    if (state !== 'published') throw new Error(`${pkg.name}@${pkg.version} is not on npm.`)
  }
  const project = mkdtempSync(join(tmpdir(), 'pawl-published-'))
  try {
    writeFileSync(
      join(project, 'package.json'),
      `${JSON.stringify({ name: 'consumer', private: true, type: 'module' })}\n`
    )
    run(
      'npm',
      ['install', '--no-audit', '--no-fund', '--ignore-scripts', ...packages.map(pkg => `${pkg.name}@${pkg.version}`)],
      project
    )
    const pawl = packages.find(pkg => pkg.name === '@santi020k/pawl')
    if (pawl) {
      const cliVersion = run(join(project, 'node_modules/.bin/pawl'), ['--version'], project)
      if (cliVersion !== pawl.version)
        throw new Error(`Expected pawl ${pawl.version}, the published CLI printed ${cliVersion}`)
    }
  } finally {
    rmSync(project, { recursive: true, force: true })
  }
  say(`${packages.map(pkg => `${pkg.name}@${pkg.version}`).join(' and ')} install from npm and run.`)
}

const notes = (file: string | undefined): void => {
  if (!file) throw new Error('Usage: node scripts/release.ts notes <file>')
  writeFileSync(file, `${releaseNotes(readPackages())}\n`)
}

const main = async (): Promise<void> => {
  const [command, argument] = process.argv.slice(2)
  if (command === 'check') check(argument)
  else if (command === 'guard') guard(argument)
  else if (command === 'plan') plan()
  else if (command === 'publish') publish()
  else if (command === 'verify') await verify()
  else if (command === 'notes') notes(argument)
  else throw new Error('Usage: node scripts/release.ts <check|guard|plan|publish|verify|notes>')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
