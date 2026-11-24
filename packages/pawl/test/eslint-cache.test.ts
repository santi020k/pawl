import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, symlinkSync } from 'node:fs'
import { findPackageJSON } from 'node:module'
import { basename, dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { EngineError, runNode } from '../src/engines/engine.ts'
import { eslintCacheFingerprint, prepareEslintCache } from '../src/engines/eslint/cache.ts'
import { runEslint } from '../src/engines/eslint/run.ts'
import { isRecord } from '../src/utils/json.ts'
import { PACKAGE_ROOT, project, write } from './helpers.ts'

/** A real ESLint install detached from concurrently edited workspace dependencies and ancestor configs. */
const isolatedEslint = (): string => {
  const store = project()
  const copied = new Map<string, string>()
  const copyPackage = (manifestPath: string): string => {
    const manifest = realpathSync(manifestPath)
    const known = copied.get(manifest)

    if (known) return known

    const target = join(store, `package-${copied.size}`)

    copied.set(manifest, target)
    cpSync(dirname(manifest), target, {
      recursive: true,
      dereference: true,
      filter: path => basename(path) !== 'node_modules'
    })

    const metadata: unknown = JSON.parse(readFileSync(manifest, 'utf8'))

    if (!isRecord(metadata)) throw new Error('Expected package metadata')

    const dependencies = isRecord(metadata.dependencies) ? Object.keys(metadata.dependencies) : []

    for (const dependency of dependencies) {
      const resolved = findPackageJSON(dependency, pathToFileURL(manifest))

      if (!resolved) throw new Error(`Missing installed dependency ${dependency}`)

      const destination = join(target, 'node_modules', dependency)

      mkdirSync(dirname(destination), { recursive: true })
      symlinkSync(copyPackage(resolved), destination)
    }

    return target
  }

  return copyPackage(join(PACKAGE_ROOT, 'node_modules/eslint/package.json'))
}

const declaration = { version: 1, deterministic: true, inputs: [] }
const saved = (root: string) => join(root, '.pawl/cache/eslint/cache.json')
const keyOf = (root: string) => {
  const value: unknown = JSON.parse(readFileSync(saved(root), 'utf8'))

  if (typeof value !== 'object' || value === null || !('key' in value)) throw new Error('Missing cache key')

  return value.key
}

describe('the deterministic ESLint cache contract', () => {
  it('requires an explicit, complete declaration', () => {
    const root = project()

    expect(() => prepareEslintCache(root)).toThrow('requires .pawl/eslint-cache.json')

    for (const invalid of [
      { ...declaration, deterministic: false },
      { ...declaration, version: 2 },
      { ...declaration, inputs: [''] },
      { ...declaration, ignored: ['src'] }
    ]) {
      write(root, { '.pawl/eslint-cache.json': invalid })
      expect(() => prepareEslintCache(root)).toThrow(EngineError)
    }
  })

  it('fingerprints ignored source, policy, config, lockfiles and dependency contents', () => {
    const root = project({
      '.gitignore': 'ignored\n',
      'src/input.ts': 'export const value = 1\n',
      'ignored/types.d.ts': 'export type Value = string\n',
      'pawl.config.mjs': 'export default {}\n',
      'eslint.config.mjs': 'export default []\n',
      'pnpm-lock.yaml': 'lockfileVersion: 9\n',
      'node_modules/plugin/index.js': 'export default {}\n',
      'node_modules/resolver/index.js': 'export default {}\n'
    })
    let previous = eslintCacheFingerprint(root, [])

    for (const file of [
      'src/input.ts',
      'ignored/types.d.ts',
      'pawl.config.mjs',
      'eslint.config.mjs',
      'pnpm-lock.yaml',
      'node_modules/plugin/index.js',
      'node_modules/resolver/index.js'
    ]) {
      write(root, { [file]: `${readFileSync(join(root, file), 'utf8')}\n` })

      const next = eslintCacheFingerprint(root, [])

      expect(next).not.toBe(previous)
      previous = next
    }
  })

  it('follows linked dependencies and declared external input additions', () => {
    const root = project()
    const dependency = project({ 'index.js': 'export default {}\n' })
    const outside = project()

    mkdirSync(join(root, 'node_modules'))
    symlinkSync(dependency, join(root, 'node_modules/plugin'))

    const first = eslintCacheFingerprint(root, [outside])

    write(dependency, { 'index.js': 'export default { changed: true }\n' })
    const second = eslintCacheFingerprint(root, [outside])

    expect(second).not.toBe(first)
    write(outside, { 'types.d.ts': 'export type Value = string\n' })
    expect(eslintCacheFingerprint(root, [outside])).not.toBe(second)
  })

  it('rejects unknown cache ownership and input changes during a run', () => {
    const root = project({ '.pawl/eslint-cache.json': declaration, 'src/a.js': 'debugger\n' })
    const session = prepareEslintCache(root)

    write(root, { 'src/a.js': 'export const changed = true\n' })
    expect(session.finish).toThrow('inputs changed during the check')
    session.dispose()
    expect(existsSync(saved(root))).toBe(false)
    write(root, { '.pawl/cache/eslint/owner.json': '{}' })
    expect(() => prepareEslintCache(root)).toThrow(EngineError)
  })

  it('invalidates environment changes without writing their values into cache metadata', () => {
    const root = project()
    const first = eslintCacheFingerprint(root, [])
    const name = 'PAWL_CACHE_TEST_INPUT'
    const original = process.env[name]

    try {
      process.env[name] = 'changed'
      expect(eslintCacheFingerprint(root, [])).not.toBe(first)
    } finally {
      if (original === undefined) delete process.env[name]
      else process.env[name] = original
    }
  })

  it('never promotes native state from an interrupted ESLint process', async () => {
    const root = project({
      '.pawl/eslint-cache.json': declaration,
      'node_modules/eslint/package.json': { name: 'eslint', version: '10.0.0', bin: { eslint: 'cli.cjs' } },
      'node_modules/eslint/cli.cjs': `const fs = require('node:fs')
const cache = process.argv[process.argv.indexOf('--cache-location') + 1]
fs.writeFileSync(cache, '[]')
process.stdout.write('[]', () => process.kill(process.pid, 'SIGTERM'))
`
    })

    await expect(runEslint({ root, eslintCache: true })).rejects.toThrow('terminated')
    expect(existsSync(saved(root))).toBe(false)
    expect(readdirSync(join(root, '.pawl/cache/eslint')).filter(file => file.startsWith('run-'))).toEqual([])
  })

  it('treats a process killed after printing a valid empty report as a setup failure', async () => {
    const root = project({ 'kill.cjs': "process.stdout.write('[]', () => process.kill(process.pid, 'SIGTERM'))\n" })

    await expect(runNode(join(root, 'kill.cjs'), [], root, 'eslint')).rejects.toThrow('terminated')
  })
})

describe('native ESLint cache behavior', { timeout: 180_000 }, () => {
  it('reuses results only for unchanged inputs, including processor dependencies, and repairs corrupt cache state', async () => {
    const trace = project()
    const external = project({ 'state.txt': 'valid' })
    const root = project({
      'package.json': { name: 'cache-fixture', private: true, type: 'module' },
      '.pawl/eslint-cache.json': { ...declaration, inputs: [external] },
      'dependency.d.ts': 'valid',
      'src/test.js': 'export const value = 1\n',
      'plugin.mjs': `import { appendFileSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
export default {
  rules: {
    dependency: {
      meta: { schema: [] },
      create(context) {
        return {
          Program(node) {
            appendFileSync(${JSON.stringify(join(trace, 'runs'))}, 'run\\n')
            if (readFileSync(join(context.cwd, 'dependency.d.ts'), 'utf8') === 'invalid' ||
              readFileSync(${JSON.stringify(join(external, 'state.txt'))}, 'utf8') === 'invalid')
              context.report({ node, message: 'Dependency is invalid' })
          }
        }
      }
    }
  },
  processors: { source: { preprocess: text => [text], postprocess: messages => messages.flat() } }
}
`,
      'eslint.config.mjs': `import plugin from './plugin.mjs'
export default [{ files: ['**/*.js'], plugins: { local: plugin }, processor: 'local/source',
  rules: { 'local/dependency': 'error', 'no-debugger': 'error' } }]
`
    })

    mkdirSync(join(root, 'node_modules'))
    symlinkSync(isolatedEslint(), join(root, 'node_modules/eslint'))

    const options = { root, files: ['src/test.js'], eslintCache: true }
    const cold = await runEslint(options)
    const initialTrace = readFileSync(join(trace, 'runs'), 'utf8')
    const first = keyOf(root)
    const warm = await runEslint(options)

    expect(cold.findings).toEqual([])
    expect(warm).toEqual(cold)
    expect(readFileSync(join(trace, 'runs'), 'utf8')).toBe(initialTrace)

    write(root, { 'dependency.d.ts': 'invalid' })
    expect((await runEslint(options)).findings).toContainEqual(expect.objectContaining({ rule: 'local/dependency' }))
    expect(keyOf(root)).not.toBe(first)

    write(root, { 'dependency.d.ts': 'valid' })
    write(external, { 'state.txt': 'invalid' })
    expect((await runEslint(options)).findings).toContainEqual(expect.objectContaining({ rule: 'local/dependency' }))

    write(external, { 'state.txt': 'valid' })
    write(root, { 'src/test.js': 'debugger\n' })
    expect((await runEslint(options)).findings).toContainEqual(expect.objectContaining({ rule: 'no-debugger' }))

    const beforeCorruption = readFileSync(join(trace, 'runs'), 'utf8')

    const damaged: unknown = JSON.parse(readFileSync(saved(root), 'utf8'))

    if (typeof damaged !== 'object' || damaged === null) throw new Error('Expected cache metadata')

    write(root, { '.pawl/cache/eslint/cache.json': { ...damaged, payload: '[]' } })
    expect((await runEslint(options)).findings).toContainEqual(expect.objectContaining({ rule: 'no-debugger' }))
    expect(readFileSync(join(trace, 'runs'), 'utf8').length).toBeGreaterThan(beforeCorruption.length)

    const accepted = readFileSync(saved(root), 'utf8')

    write(root, { 'eslint.config.mjs': "throw new Error('setup unavailable')\n" })
    await expect(runEslint(options)).rejects.toThrow(EngineError)
    expect(readFileSync(saved(root), 'utf8')).toBe(accepted)
    expect(readdirSync(join(root, '.pawl/cache/eslint')).filter(file => file.startsWith('run-'))).toEqual([])
  })

  it('never requires a cache contract or writes cache state during fixes', async () => {
    const root = project({
      'package.json': { type: 'module' },
      'eslint.config.mjs': "export default [{ rules: { 'no-debugger': 'error' } }]\n",
      'source.js': 'debugger\n'
    })

    mkdirSync(join(root, 'node_modules'))
    symlinkSync(isolatedEslint(), join(root, 'node_modules/eslint'))
    const result = await runEslint({ root, files: ['source.js'], write: true, eslintCache: true })

    expect(result.command).not.toContain('--cache')
    expect(existsSync(join(root, '.pawl/cache'))).toBe(false)
  })
})
