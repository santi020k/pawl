import { cpSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { findPackageJSON } from 'node:module'
import { basename, dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runEslint } from '../src/engines/eslint/run.ts'
import { isRecord } from '../src/utils/json.ts'
import { PACKAGE_ROOT, project, write } from './helpers.ts'

/** Copy real installed packages so fingerprinting does not reach the concurrently edited repository. */
const isolatedToolchain = (store: string): Record<string, string> => {
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

    if (!isRecord(metadata)) throw new Error('Expected package metadata.')

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

  const versions: Record<string, string> = {}
  const fixture = join(PACKAGE_ROOT, 'test/fixtures/eslint')

  // Shared peer resolution from every copied package uses this isolated ancestor, including TS 6.
  for (const name of ['eslint', 'typescript', 'typescript-eslint']) {
    const manifest = join(fixture, 'node_modules', name, 'package.json')
    const metadata: unknown = JSON.parse(readFileSync(manifest, 'utf8'))

    if (!isRecord(metadata) || typeof metadata.version !== 'string') throw new Error('Expected package version.')

    versions[name] = metadata.version
    mkdirSync(join(store, 'node_modules'), { recursive: true })
    symlinkSync(copyPackage(manifest), join(store, 'node_modules', name))
  }

  return versions
}

const cacheKey = (root: string): string => {
  const value: unknown = JSON.parse(readFileSync(join(root, '.pawl/cache/eslint/cache.json'), 'utf8'))

  if (!isRecord(value) || typeof value.key !== 'string') throw new Error('Expected an accepted cache key.')

  return value.key
}

describe('cached TypeScript program dependencies', { timeout: 180_000 }, () => {
  it('invalidates an unchanged entry when an imported return type becomes a promise', async () => {
    const store = project()
    const trace = project()
    const root = project({
      'package.json': { name: 'typed-cache-fixture', private: true, type: 'module' },
      '.pawl/eslint-cache.json': { version: 1, deterministic: true, inputs: [] },
      'tsconfig.json': {
        compilerOptions: { strict: true, target: 'ES2022', module: 'NodeNext', noEmit: true },
        include: ['src/**/*.ts']
      },
      'src/dependency.ts': 'export declare function perform(): void\n',
      'src/entry.ts': "import { perform } from './dependency.js'\nperform()\n",
      'eslint.config.mjs': `import { appendFileSync } from 'node:fs'
import typescript from 'typescript-eslint'
export default [{
  files: ['**/*.ts'],
  languageOptions: {
    parser: typescript.parser,
    parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname }
  },
  plugins: {
    '@typescript-eslint': typescript.plugin,
    trace: { rules: { visits: {
      meta: { schema: [] },
      create: () => ({ Program: () => appendFileSync(${JSON.stringify(join(trace, 'visits'))}, 'visit\\n') })
    } } }
  },
  rules: { '@typescript-eslint/no-floating-promises': 'error', 'trace/visits': 'error' }
}]
`
    })

    try {
      const versions = isolatedToolchain(store)

      symlinkSync(join(store, 'node_modules'), join(root, 'node_modules'))

      const options = { root, files: ['src/entry.ts'], eslintCache: true }
      const entry = readFileSync(join(root, 'src/entry.ts'), 'utf8')
      const pairs: Array<{ coldMs: number; warmMs: number }> = []

      // Only the native cache is removed. Coverage, source, configuration and installed tools stay identical.
      for (let index = 0; index < 3; index++) {
        rmSync(join(root, '.pawl/cache/eslint'), { recursive: true, force: true })

        const startCold = performance.now()
        const cold = await runEslint(options)
        const coldMs = performance.now() - startCold
        const afterCold = readFileSync(join(trace, 'visits'), 'utf8')
        const key = cacheKey(root)
        const startWarm = performance.now()
        const warm = await runEslint(options)

        pairs.push({ coldMs: Math.round(coldMs), warmMs: Math.round(performance.now() - startWarm) })
        expect(cold.findings).toEqual([])
        expect(warm).toEqual(cold)
        expect(cacheKey(root)).toBe(key)
        expect(readFileSync(join(trace, 'visits'), 'utf8')).toBe(afterCold)
      }

      const previousKey = cacheKey(root)
      const previousVisits = readFileSync(join(trace, 'visits'), 'utf8')

      write(root, { 'src/dependency.ts': 'export declare function perform(): Promise<void>\n' })

      const changed = await runEslint(options)

      expect(readFileSync(join(root, 'src/entry.ts'), 'utf8')).toBe(entry)
      expect(cacheKey(root)).not.toBe(previousKey)
      expect(readFileSync(join(trace, 'visits'), 'utf8').length).toBeGreaterThan(previousVisits.length)
      expect(changed.findings).toContainEqual(
        expect.objectContaining({
          file: 'src/entry.ts',
          rule: '@typescript-eslint/no-floating-promises',
          severity: 'error'
        })
      )

      const uncached = await runEslint({ root, files: options.files })

      expect(changed.findings).toEqual(uncached.findings)

      write(root, { 'src/dependency.ts': 'export declare function perform(): void\n' })
      expect((await runEslint(options)).findings).toEqual([])

      process.stdout.write(
        `PAWL_CACHE_TYPES_BENCHMARK ${JSON.stringify({ node: process.versions.node, versions, files: options.files, pairs })}\n`
      )
    } finally {
      for (const directory of [root, store, trace]) rmSync(directory, { recursive: true, force: true })
    }
  })
})
