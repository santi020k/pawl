import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { ancestors } from './fs.ts'
import { readJson } from './json.ts'

/**
 * The part of semver ranges that peer dependencies and `engines` use: exact versions,
 * `>=`, `>`, `<=`, `<`, `=`, `^`, `~`, `x` wildcards, `*`, a space for "and" and `||` for "or".
 * Prerelease tags are compared after the numbers, which is enough to say whether a tool fits.
 */
type Triple = [number, number, number]

const parse = (version: string): { triple: Triple; pre: string } | undefined => {
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([\w.-]+))?(?:\+[\w.-]+)?$/.exec(version.trim())

  if (!match) return undefined

  return { triple: [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)], pre: match[4] ?? '' }
}

const compare = (a: string, b: string): number => {
  const left = parse(a)
  const right = parse(b)

  if (!left || !right) return Number.NaN

  for (let index = 0; index < 3; index++) {
    const diff = (left.triple[index] as number) - (right.triple[index] as number)

    if (diff !== 0) return diff
  }

  // A prerelease comes before its release.
  if (left.pre === right.pre) return 0

  if (left.pre === '') return 1

  if (right.pre === '') return -1

  return left.pre < right.pre ? -1 : 1
}

/** The comparators one range term stands for, such as `^2.1` for `>=2.1.0 <3.0.0`. */
const expand = (term: string): string[] | undefined => {
  if (term === '*' || term === '' || /^[xX]$/.test(term)) return []

  const match = /^(\^|~|>=|<=|>|<|=)?\s*v?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(-[\w.-]+)?$/.exec(term)

  if (!match) return undefined

  const [, op = '', majorText = '0', minorText, patchText, pre = ''] = match
  const wild = (part: string | undefined): boolean => part === undefined || /^[xX*]$/.test(part)
  const major = Number(majorText)
  const minor = wild(minorText) ? undefined : Number(minorText)
  const patch = wild(patchText) ? undefined : Number(patchText)

  if (wild(majorText)) return []

  const floor = `${major}.${minor ?? 0}.${patch ?? 0}${pre}`

  if (op === '^') {
    // The first number that is not zero may not change: ^1.2.3 is below 2, ^0.2.3 below 0.3, ^0.0.3 below 0.0.4.
    let ceiling = `0.0.${(patch ?? 0) + 1}`

    if (major > 0 || minor === undefined) ceiling = `${major + 1}.0.0`
    else if (minor > 0 || patch === undefined) ceiling = `0.${minor + 1}.0`

    return [`>=${floor}`, `<${ceiling}-0`]
  }

  if (op === '~')
    return [`>=${floor}`, `<${minor === undefined ? major + 1 : major}.${minor === undefined ? 0 : minor + 1}.0-0`]

  if (op === '' || op === '=') {
    if (minor === undefined) return [`>=${major}.0.0`, `<${major + 1}.0.0-0`]

    if (patch === undefined) return [`>=${major}.${minor}.0`, `<${major}.${minor + 1}.0-0`]

    return [`=${floor}`]
  }

  return [`${op}${floor}`]
}

const test = (version: string, comparator: string): boolean => {
  const match = /^(>=|<=|>|<|=)(.+)$/.exec(comparator)

  if (!match) return false

  const order = compare(version, match[2] as string)

  if (Number.isNaN(order)) return false

  switch (match[1]) {
    case '>=':
      return order >= 0
    case '<=':
      return order <= 0
    case '>':
      return order > 0
    case '<':
      return order < 0
    default:
      return order === 0
  }
}

/** True when a version is in a range. A range pawl cannot read is never satisfied. */
export const satisfies = (version: string, range: string): boolean => {
  if (!parse(version)) return false

  return range.split('||').some(alternative => {
    // "1.2.3 - 2.0.0" is a hyphen range.
    const hyphen = /^\s*(\S+)\s+-\s+(\S+)\s*$/.exec(alternative)
    const terms = hyphen ? [`>=${hyphen[1]}`, `<=${hyphen[2]}`] : alternative.trim().split(/\s+/)
    const comparators = terms.map(expand)

    if (comparators.some(list => list === undefined)) return false

    return comparators.flat().every(comparator => test(version, comparator as string))
  })
}

/**
 * The version of a package as Node would find it from the project, without loading it:
 * the nearest `node_modules` that has it. Pawl's own location is the fallback, as for Biome.
 */
export const installedVersion = (root: string, name: string, fallback?: string): string | undefined => {
  for (const start of [root, ...(fallback ? [fallback] : [])]) {
    for (const dir of ancestors(start)) {
      const manifest = join(dir, 'node_modules', name, 'package.json')

      if (existsSync(manifest)) return readJson<{ version?: string }>(manifest)?.version
    }
  }

  return undefined
}
