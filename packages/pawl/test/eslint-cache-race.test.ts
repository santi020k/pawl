// Two checks that start at once on a project without an ESLint cache yet both take the cache
// directory. These tests put the other check's step between two of this one's, where it can land.
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { prepareEslintCache } from '../src/engines/eslint/cache.ts'
import { project } from './helpers.ts'

const race = vi.hoisted(() => ({ before: undefined as 'list' | 'own' | undefined }))

vi.mock('node:fs', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs')>()
  // What the other check does once it owns the directory: write the owner file and start its run.
  const otherCheck = (directory: string): void => {
    race.before = undefined
    fs.writeFileSync(join(directory, 'owner.json'), '{"pawlEslintCache":1}\n', { flag: 'wx' })
    fs.mkdirSync(join(directory, 'run-other'))
  }

  return {
    ...fs,
    readdirSync: ((path: string, ...rest: unknown[]) => {
      if (race.before === 'list' && rest.length === 0 && path.endsWith(join('cache', 'eslint'))) otherCheck(path)

      return (fs.readdirSync as (...args: unknown[]) => unknown)(path, ...rest)
    }) as typeof fs.readdirSync,
    writeFileSync: ((path: string, ...rest: unknown[]) => {
      if (race.before === 'own' && String(path).endsWith('owner.json')) otherCheck(join(String(path), '..'))

      return (fs.writeFileSync as (...args: unknown[]) => unknown)(path, ...rest)
    }) as typeof fs.writeFileSync
  }
})

describe('two checks that start at once with --eslint-cache', () => {
  it.each(['list', 'own'] as const)('share the cache directory the other one took (%s)', step => {
    const root = project({ '.pawl/eslint-cache.json': { version: 1, deterministic: true, inputs: [] } })

    race.before = step

    const session = prepareEslintCache(root)

    expect(race.before).toBeUndefined()
    expect(session.flags).toContain('--cache')
    session.dispose()
  })
})
