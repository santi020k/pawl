import { matchesGlob } from 'node:path'
import { expandBraces, literalBrackets, toEngineGlob } from '../../project/ignores.ts'

/** Intersect a policy glob with one package without changing the root-relative meaning. */
export const packagePatterns = (patterns: readonly string[], dir: string): string[] => {
  const folders = dir.split('/')
  const project = (pattern: string): string[] => {
    const negated = pattern.startsWith('!')
    const body = negated ? pattern.slice(1) : pattern

    return expandBraces(body).flatMap(expanded => {
      const parts = expanded.split('/')
      const memo = new Map<string, string[]>()
      const visit = (part: number, folder: number): string[] => {
        const key = `${part}:${folder}`
        const cached = memo.get(key)

        if (cached) return cached

        const token = parts[part]
        const name = folders[folder]
        let suffixes: string[]

        if (folder === folders.length) suffixes = part === parts.length ? [] : [parts.slice(part).join('/')]
        else if (token === undefined || name === undefined) suffixes = []
        else if (token === '**') suffixes = [...visit(part + 1, folder), ...visit(part, folder + 1)]
        else suffixes = matchesGlob(name, token) ? visit(part + 1, folder + 1) : []

        const result = [...new Set(suffixes)]

        memo.set(key, result)

        return result
      }

      return visit(0, 0).map(suffix => `${negated ? '!' : ''}${literalBrackets(dir)}/${suffix}`)
    })
  }

  return patterns.flatMap(pattern => [...new Set(project(toEngineGlob(pattern)))])
}

/** A package owns its files, but not another workspace nested beneath it. */
export const nestedPackageExclusions = (dir: string, packages: readonly string[]): string[] =>
  packages.filter(candidate => candidate.startsWith(`${dir}/`)).map(candidate => `!${literalBrackets(candidate)}/**`)
