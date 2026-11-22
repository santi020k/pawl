import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * A language other than JavaScript and TypeScript. Pawl finds projects in these languages and,
 * when the policy names the language, checks them with that language's own tools.
 */
export type Language = 'rust' | 'swift' | 'kotlin'

export const LANGUAGES: readonly Language[] = ['rust', 'swift', 'kotlin']

/** A project in another language: where it lives, and what marks it. */
export interface LanguageProject {
  /** The folder, relative to the repo root, with forward slashes. Empty for the root itself. */
  dir: string
  language: Language
  /** The file or folder in `dir` that marks the project, such as Cargo.toml, Package.swift or App.xcodeproj. */
  manifest: string
}

/** What a language is called, and the tools that check it. */
export interface LanguageInfo {
  title: string
  /** File extensions of its source code, without the dot. */
  extensions: readonly string[]
  lint: string
  format: string
  /** How to install the tools, in words a person can act on. */
  install: string
}

export const LANGUAGE_INFO: Record<Language, LanguageInfo> = {
  rust: {
    title: 'Rust',
    extensions: ['rs'],
    lint: 'Clippy',
    format: 'rustfmt',
    install: 'Install Rust with rustup, then run "rustup component add clippy rustfmt".'
  },
  swift: {
    title: 'Swift',
    extensions: ['swift'],
    lint: 'SwiftLint',
    format: 'SwiftFormat or swift-format',
    install:
      'Install SwiftLint and SwiftFormat ("brew install swiftlint swiftformat"). Apple\'s swift-format, which comes with Swift 6 and Xcode 16, also formats.'
  },
  kotlin: {
    title: 'Kotlin',
    extensions: ['kt', 'kts'],
    lint: 'ktlint',
    format: 'ktlint',
    install: 'Install ktlint ("brew install ktlint", or the binary from its GitHub releases).'
  }
}

/** One file or folder the walk found that may mark a project. */
export interface Marker {
  /** The folder it is in, relative to the root, with forward slashes. */
  dir: string
  name: string
}

const GRADLE_FILES = ['settings.gradle.kts', 'settings.gradle', 'build.gradle.kts', 'build.gradle']

const XCODE_FOLDER = /\.(?:xcodeproj|xcworkspace)$/

/** Folders that belong to Xcode and hold nothing anyone writes by hand, so a walk need not enter them. */
export const XCODE_BUNDLE = /\.(?:xcodeproj|xcworkspace|xcassets|xcframework)$/

/** The name of a file or folder that marks a project in another language, else undefined. */
export const markerLanguage = (name: string, isDirectory: boolean): 'rust' | 'swift' | 'jvm' | undefined => {
  if (isDirectory) return XCODE_FOLDER.test(name) ? 'swift' : undefined

  if (name === 'Cargo.toml') return 'rust'

  if (name === 'Package.swift') return 'swift'

  return GRADLE_FILES.includes(name) || name === 'pom.xml' ? 'jvm' : undefined
}

/** A build folder that a tool writes next to its manifest: `target` beside Cargo.toml or pom.xml. */
export const isBuildFolder = (name: string, siblings: readonly string[]): boolean =>
  name === 'target' && (siblings.includes('Cargo.toml') || siblings.includes('pom.xml'))

const read = (file: string): string => {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

const inside = (dir: string, parent: string): boolean => parent === '' || dir.startsWith(`${parent}/`)

const depth = (dir: string): number => (dir === '' ? 0 : dir.split('/').length)

const KOTLIN_IN_BUILD = /kotlin/i

/** A Gradle or Maven project is a Kotlin project when its build says so. A Java one is not pawl's to check. */
const isKotlin = (root: string, dir: string, markers: readonly Marker[]): boolean =>
  markers.some(
    marker =>
      (marker.dir === dir || inside(marker.dir, dir)) &&
      (marker.name.endsWith('.kts') ||
        ((marker.name.startsWith('build.gradle') || marker.name === 'pom.xml') &&
          KOTLIN_IN_BUILD.test(read(join(root, marker.dir, marker.name)))))
  )

/** The manifest to name for a project, when one folder has several. */
const PREFERRED = ['Cargo.toml', 'Package.swift', ...GRADLE_FILES, 'pom.xml']

const preferred = (names: readonly string[]): string =>
  [...names].sort((a, b) => {
    const rank = (name: string): number => {
      const index = PREFERRED.indexOf(name)

      if (index !== -1) return index

      return name.endsWith('.xcworkspace') ? PREFERRED.length : PREFERRED.length + 1
    }

    return rank(a) - rank(b) || a.localeCompare(b)
  })[0] as string

/**
 * The projects the markers point at. A project inside another of the same kind is part of it:
 * a crate in a Cargo workspace, a Swift package in an app, a Gradle module. A crate inside a
 * crate that is not a workspace is a project of its own, as Cargo sees it.
 */
export const languageProjects = (root: string, markers: readonly Marker[]): LanguageProject[] => {
  const byKind = new Map<string, Map<string, string[]>>()

  for (const marker of markers) {
    const kind = markerLanguage(marker.name, XCODE_FOLDER.test(marker.name))

    if (!kind) continue

    const dirs = byKind.get(kind) ?? new Map<string, string[]>()

    dirs.set(marker.dir, [...(dirs.get(marker.dir) ?? []), marker.name])
    byKind.set(kind, dirs)
  }

  const projects: LanguageProject[] = []

  for (const [kind, dirs] of byKind) {
    const found: string[] = []

    for (const dir of [...dirs.keys()].sort((a, b) => depth(a) - depth(b) || a.localeCompare(b))) {
      const parent = found.find(other => inside(dir, other))
      const contained =
        parent !== undefined && (kind !== 'rust' || /^\s*\[workspace\]/m.test(read(join(root, parent, 'Cargo.toml'))))

      if (contained) continue

      found.push(dir)

      const manifest = preferred(dirs.get(dir) ?? [])

      if (kind === 'jvm') {
        if (isKotlin(root, dir, markers)) projects.push({ dir, language: 'kotlin', manifest })
      } else {
        projects.push({ dir, language: kind === 'rust' ? 'rust' : 'swift', manifest })
      }
    }
  }

  return projects.sort((a, b) => a.dir.localeCompare(b.dir) || a.language.localeCompare(b.language))
}

/**
 * Folders the tools of these projects write, which nothing should lint: the `target` of Cargo
 * and of Maven, next to the project's manifest. They are anchored to the project, because
 * `target` is also a name people give their own code.
 */
export const languageIgnores = (projects: readonly LanguageProject[]): string[] => [
  ...new Set(
    projects.flatMap(({ dir, language, manifest }) =>
      language === 'rust' || manifest === 'pom.xml' ? [dir ? `${dir}/target/**` : 'target/**'] : []
    )
  )
]

/** The languages these projects are in, in a fixed order. */
export const languagesOf = (projects: readonly LanguageProject[]): Language[] =>
  LANGUAGES.filter(language => projects.some(project => project.language === language))
