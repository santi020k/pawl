/**
 * The releases collection, shaped for the pages that show it: the changelog, its table of contents and the
 * landing page's version badge.
 */
import { getCollection } from 'astro:content'

const repo = 'https://github.com/santi020k/pawl'

export interface ReleaseView {
  /** The heading's id on the changelog page. */
  id: string
  title: string
  version?: string
  /** Released: on npm, with its tag. */
  released: boolean
  /** The newest released version. */
  latest: boolean
  date?: Date
  links: { label: string; href: string }[]
  packages: { name: string; groups: { kind: string; html: string }[] }[]
}

const dateFormat = new Intl.DateTimeFormat('en', { dateStyle: 'long', timeZone: 'UTC' })

export const formatDate = (date: Date): string => dateFormat.format(date)

/** The pending release first, then every version, newest first. */
export const getReleases = async (): Promise<ReleaseView[]> => {
  const entries = (await getCollection('releases')).sort((a, b) => a.data.order - b.data.order)
  const latest = entries.find(entry => entry.data.version && entry.data.date)?.data.version
  const versions = entries.flatMap(entry => (entry.data.version ? [entry.data.version] : []))

  return entries.map(({ data }) => {
    const { version } = data
    const date = data.date ? new Date(data.date) : undefined

    if (!version) {
      return {
        id: 'next-release',
        title: 'Next release',
        released: false,
        latest: false,
        links: [],
        packages: data.packages
      }
    }

    const previous = versions[versions.indexOf(version) + 1]
    const links = date
      ? [
          { label: 'npm', href: `https://www.npmjs.com/package/@santi020k/pawl/v/${version}` },
          { label: 'GitHub release', href: `${repo}/releases/tag/v${version}` },
          previous
            ? { label: `Changes since ${previous}`, href: `${repo}/compare/v${previous}...v${version}` }
            : { label: 'Source', href: `${repo}/tree/v${version}` }
        ]
      : []

    return {
      id: `v${version.replaceAll('.', '-')}`,
      title: version,
      version,
      released: date !== undefined,
      latest: version === latest,
      ...(date ? { date } : {}),
      links,
      packages: data.packages
    }
  })
}

/**
 * The version to name on the landing page: the newest one on npm, or the newest one in the changelogs when the
 * repository has no tags, as in a shallow clone.
 */
export const currentVersion = async (): Promise<string | undefined> => {
  const releases = (await getReleases()).filter(release => release.version)

  return (releases.find(release => release.latest) ?? releases[0])?.version
}
