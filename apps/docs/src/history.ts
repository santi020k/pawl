/**
 * Pawl's release history, for the changelog page. Read at build time from three places:
 *
 * - each package's CHANGELOG.md, which Changesets writes on a release branch;
 * - the `v<version>` git tag that the release workflow creates once a version is on npm, for its date;
 * - the changesets in .changeset/ that are merged but not released yet.
 *
 * Nothing here is written by hand, so the page follows the release process without a step of its own.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** One heading Changesets writes under a version, such as "Minor Changes", and the Markdown below it. */
export interface ChangeGroup {
  kind: string
  markdown: string
}

export interface PackageNotes {
  name: string
  groups: ChangeGroup[]
}

export interface Release {
  /** The version, or undefined for the changes merged since the last release. */
  version?: string
  /** When the version's tag was made, as an ISO date. Undefined until the version is released. */
  date?: string
  packages: PackageNotes[]
}

interface Changelog {
  name: string
  versions: Map<string, ChangeGroup[]>
}

const BUMPS = ['major', 'minor', 'patch'] as const

type Bump = (typeof BUMPS)[number]

/** The headings Changesets uses for each kind of bump. */
const KINDS: Record<Bump, string> = { major: 'Major Changes', minor: 'Minor Changes', patch: 'Patch Changes' }

const isBump = (value: string): value is Bump => (BUMPS as readonly string[]).includes(value)

/** Split Markdown into the sections under one heading level, keyed by the heading's text. */
const sections = (markdown: string, level: number): [string, string][] => {
  const marker = `${'#'.repeat(level)} `
  const found: [string, string][] = []
  let current: [string, string[]] | undefined
  let fence: string | undefined

  for (const line of markdown.split('\n')) {
    const opening = /^\s*(`{3,}|~{3,})/.exec(line)?.[1]

    if (opening && (fence === undefined || opening.startsWith(fence))) fence = fence === undefined ? opening : undefined

    if (fence === undefined && line.startsWith(marker)) {
      if (current) found.push([current[0], current[1].join('\n').trim()])

      current = [line.slice(marker.length).trim(), []]
    } else current?.[1].push(line)
  }

  if (current) found.push([current[0], current[1].join('\n').trim()])

  return found
}

/** Read a CHANGELOG.md in the format Changesets writes: `# name`, then `## version`, then `### Minor Changes` and so on. */
export const parseChangelog = (text: string): Changelog => {
  const name = /^# (.+)$/m.exec(text)?.[1]?.trim() ?? ''
  const versions = new Map<string, ChangeGroup[]>()

  for (const [version, body] of sections(text, 2)) {
    const groups = sections(body, 3)
      .map(([kind, markdown]) => ({ kind, markdown }))
      .filter(group => group.markdown.length > 0)

    // A version written without kind headings keeps its notes as one group.
    if (groups.length === 0 && body) groups.push({ kind: 'Changes', markdown: body })

    versions.set(version, groups)
  }

  return { name, versions }
}

export interface Changeset {
  bumps: { name: string; bump: Bump }[]
  summary: string
}

/** Read one changeset file: front matter that maps package names to a bump, then the summary. */
export const parseChangeset = (text: string): Changeset | undefined => {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text)

  if (!match) return undefined

  const bumps = (match[1] ?? '').split(/\r?\n/).flatMap(line => {
    const entry = /^\s*["']?([^"':]+)["']?\s*:\s*["']?(\w+)["']?\s*$/.exec(line)
    const name = entry?.[1]?.trim()
    const bump = entry?.[2]

    return name && bump && isBump(bump) ? [{ name, bump }] : []
  })
  const summary = (match[2] ?? '').trim()

  return bumps.length > 0 && summary ? { bumps, summary } : undefined
}

/** The notes for the changes merged since the last release, grouped the way Changesets will group them. */
export const pendingRelease = (changesets: readonly Changeset[], order: readonly string[]): Release | undefined => {
  const packages = new Map<string, Map<Bump, string[]>>()

  for (const changeset of changesets) {
    // Indent every line after the first, so a summary of several paragraphs stays one list item.
    const item = `- ${changeset.summary.replace(/\n/g, '\n  ')}`

    for (const { name, bump } of changeset.bumps) {
      const byBump = packages.get(name) ?? new Map<Bump, string[]>()

      byBump.set(bump, [...(byBump.get(bump) ?? []), item])
      packages.set(name, byBump)
    }
  }

  if (packages.size === 0) return undefined

  const rank = (name: string): number => (order.includes(name) ? order.indexOf(name) : order.length)

  return {
    packages: [...packages]
      .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
      .map(([name, byBump]) => ({
        name,
        groups: BUMPS.flatMap(bump => {
          const items = byBump.get(bump)

          return items ? [{ kind: KINDS[bump], markdown: items.join('\n') }] : []
        })
      }))
  }
}

const versionParts = (version: string): { numbers: number[]; pre: string } => {
  const [core = '', pre = ''] = version.split('-', 2)

  return { numbers: core.split('.').map(part => Number.parseInt(part, 10) || 0), pre }
}

/** Newest first, by semantic version. A prerelease comes before its release. */
export const compareVersions = (a: string, b: string): number => {
  const left = versionParts(a)
  const right = versionParts(b)

  for (let index = 0; index < 3; index++) {
    const difference = (right.numbers[index] ?? 0) - (left.numbers[index] ?? 0)

    if (difference !== 0) return difference
  }

  if (left.pre === right.pre) return 0

  if (!left.pre) return -1

  if (!right.pre) return 1

  return right.pre.localeCompare(left.pre, 'en', { numeric: true })
}

/** Every version any changelog lists, newest first, with each package's notes for it. */
export const releasesFrom = (
  changelogs: readonly Changelog[],
  tagDate: (version: string) => string | undefined
): Release[] => {
  const versions = [...new Set(changelogs.flatMap(changelog => [...changelog.versions.keys()]))].sort(compareVersions)

  return versions.map(version => {
    const date = tagDate(version)
    const packages = changelogs.flatMap(changelog => {
      const groups = changelog.versions.get(version)

      return groups ? [{ name: changelog.name, groups }] : []
    })

    return date ? { version, date, packages } : { version, packages }
  })
}

/** The date of the commit a tag points at, or undefined when the tag does not exist here. */
const gitTagDate =
  (root: string) =>
  (version: string): string | undefined => {
    try {
      const output = execFileSync('git', ['log', '-1', '--format=%cI', `refs/tags/v${version}`], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim()

      return output || undefined
    } catch {
      return undefined
    }
  }

/** The files the history is read from, so a dev server can watch them. */
export const historyFiles = (root: string): string[] => {
  const packagesDir = join(root, 'packages')
  const changelogs = existsSync(packagesDir)
    ? readdirSync(packagesDir)
        .sort()
        .map(entry => join(packagesDir, entry, 'CHANGELOG.md'))
        .filter(file => existsSync(file))
    : []
  const changesetDir = join(root, '.changeset')
  const changesets = existsSync(changesetDir)
    ? readdirSync(changesetDir)
        .filter(file => file.endsWith('.md') && file.toLowerCase() !== 'readme.md')
        .sort()
        .map(file => join(changesetDir, file))
    : []

  return [...changelogs, ...changesets]
}

/** The whole history of the repository at `root`: the pending release, if any, then every version, newest first. */
export const readHistory = (root: string, tagDate = gitTagDate(root)): Release[] => {
  const files = historyFiles(root)
  const changelogs = files
    .filter(file => file.endsWith('CHANGELOG.md'))
    .map(file => parseChangelog(readFileSync(file, 'utf8')))
    .filter(changelog => changelog.name)
  const changesets = files
    .filter(file => !file.endsWith('CHANGELOG.md'))
    .flatMap(file => parseChangeset(readFileSync(file, 'utf8')) ?? [])
  const order = changelogs.map(changelog => changelog.name)
  const pending = pendingRelease(changesets, order)

  return [...(pending ? [pending] : []), ...releasesFrom(changelogs, tagDate)]
}
