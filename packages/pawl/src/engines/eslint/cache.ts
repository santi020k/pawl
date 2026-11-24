/** Opt-in native ESLint caching with a project-wide deterministic-input contract. */
import { createHash, type Hash } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { ESLINT_CONFIG_FILES, PAWL_CONFIG_FILES } from '../../project/config-files.ts'
import { isRecord } from '../../utils/json.ts'
import { VERSION } from '../../version.ts'
import { EngineError } from '../engine.ts'

const CONFIG = '.pawl/eslint-cache.json'
const DIRECTORY = '.pawl/cache/eslint'
const MAX_FILES = 100_000
const MAX_BYTES = 2 * 1024 * 1024 * 1024
const LIMIT = 'ESLint cache inputs exceed the bounded snapshot. Run without --eslint-cache or reduce the input tree.'

interface Contract {
  inputs: string[]
}

/** Paths are explicit filesystem inputs, not globs. Nothing is inferred from executable config. */
const contract = (root: string): Contract => {
  try {
    const value: unknown = JSON.parse(readFileSync(join(root, CONFIG), 'utf8'))

    if (
      isRecord(value) &&
      value.version === 1 &&
      value.deterministic === true &&
      Array.isArray(value.inputs) &&
      value.inputs.every((input): input is string => typeof input === 'string' && input.trim().length > 0) &&
      Object.keys(value).every(key => ['version', 'deterministic', 'inputs'].includes(key))
    ) {
      return { inputs: value.inputs }
    }
  } catch {
    // The same actionable message applies to an absent, unreadable or malformed declaration.
  }

  throw new EngineError(
    `ESLint caching requires ${CONFIG} with version: 1, deterministic: true and inputs: an array of external paths. Only opt in when all inputs are known; otherwise run without --eslint-cache.`,
    { command: 'eslint --cache' }
  )
}

const hash = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex')

const add = (digest: Hash, value: string | Buffer): void => {
  const bytes = typeof value === 'string' ? Buffer.from(value) : value

  digest.update(`${bytes.length}:`).update(bytes)
}

/** Include every Node resolution ancestor, including the dependencies beside a pnpm symlink target. */
const resolutionInputs = (start: string): string[] => {
  const paths: string[] = []
  let dir = start

  for (;;) {
    paths.push(join(dir, 'node_modules'))

    for (const name of [
      'package.json',
      'pnpm-lock.yaml',
      'package-lock.json',
      'yarn.lock',
      '.pnp.cjs',
      'tsconfig.json',
      'jsconfig.json',
      '.gitignore',
      ...ESLINT_CONFIG_FILES,
      ...PAWL_CONFIG_FILES
    ])
      paths.push(join(dir, name))

    const parent = dirname(dir)

    if (parent === dir) return paths

    dir = parent
  }
}

/** Content, paths, links, runtime and environment all participate. Only this cache's own output is excluded. */
export const eslintCacheFingerprint = (root: string, external: readonly string[]): string => {
  const digest = createHash('sha256')
  const seen = new Set<string>()
  const output = resolve(root, DIRECTORY)
  let files = 0
  let bytes = 0

  add(
    digest,
    JSON.stringify({
      version: 1,
      pawl: VERSION,
      root: realpathSync(root),
      execPath: process.execPath,
      runtime: process.versions,
      platform: process.platform,
      arch: process.arch,
      args: process.execArgv,
      env: Object.entries(process.env).sort(([a], [b]) => a.localeCompare(b))
    })
  )

  const walk = (path: string): void => {
    const absolute = resolve(path)

    if (absolute === output || absolute.startsWith(`${output}${sep}`)) return

    add(digest, absolute)

    if (seen.has(absolute)) return

    seen.add(absolute)

    if (++files > MAX_FILES) throw new Error(LIMIT)

    let stat: ReturnType<typeof lstatSync>

    try {
      stat = lstatSync(absolute)
    } catch (error) {
      if (isRecord(error) && error.code === 'ENOENT') {
        add(digest, 'missing')

        return
      }

      throw error
    }

    if (stat.isSymbolicLink()) {
      const target = realpathSync(absolute)

      add(digest, `link:${target}`)
      walk(target)

      for (const input of resolutionInputs(dirname(target))) walk(input)
    } else if (stat.isDirectory()) {
      add(digest, 'directory')

      for (const entry of readdirSync(absolute).sort()) walk(join(absolute, entry))
    } else if (stat.isFile()) {
      bytes += stat.size

      if (bytes > MAX_BYTES) throw new Error(LIMIT)

      add(digest, `file:${stat.mode}`)
      add(digest, readFileSync(absolute))
    } else {
      throw new Error('An ESLint cache input is not a regular file, directory or symbolic link.')
    }
  }

  walk(root)
  walk(process.execPath)

  for (const input of [...resolutionInputs(dirname(root)), ...external.map(path => resolve(root, path))].sort())
    walk(input)

  return digest.digest('hex')
}

/** Refuse links or unknown data in the cache namespace; do not overwrite a user's files. */
const cacheDirectory = (root: string): string => {
  const directory = join(root, DIRECTORY)

  for (const path of [join(root, '.pawl'), join(root, '.pawl/cache'), directory]) {
    if (existsSync(path) && (!lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink()))
      throw new Error('The ESLint cache directory must be a regular directory, not a symbolic link.')
  }

  mkdirSync(directory, { recursive: true })

  const owner = join(directory, 'owner.json')
  const expected = '{"pawlEslintCache":1}\n'

  if (!existsSync(owner)) {
    if (readdirSync(directory).length > 0) throw new Error('The ESLint cache directory contains unowned files.')

    writeFileSync(owner, expected, { flag: 'wx', mode: 0o600 })
  } else if (lstatSync(owner).isSymbolicLink() || readFileSync(owner, 'utf8') !== expected) {
    throw new Error('The ESLint cache directory has unrecognized ownership metadata.')
  }

  return directory
}

interface CacheRecord {
  version: 1
  key: string
  checksum: string
  payload: string
}

/** Corrupt or interrupted cache state is a miss, never a result. */
const readCache = (path: string, key: string): string | undefined => {
  try {
    if (lstatSync(path).isSymbolicLink()) return undefined

    const value: unknown = JSON.parse(readFileSync(path, 'utf8'))

    if (
      !isRecord(value) ||
      value.version !== 1 ||
      value.key !== key ||
      typeof value.payload !== 'string' ||
      value.checksum !== hash(value.payload)
    )
      return undefined

    JSON.parse(value.payload)

    return value.payload
  } catch {
    return undefined
  }
}

export interface EslintCacheSession {
  flags: string[]
  /** Promote only after ESLint produced a validated report with a normal exit. */
  finish: () => void
  dispose: () => void
}

const dispose = (directory: string): void => {
  try {
    rmSync(directory, { recursive: true, force: true })
  } catch (cause) {
    throw new EngineError('ESLint cache temporary files could not be removed safely.', {
      command: 'eslint --cache',
      cause
    })
  }
}

export const prepareEslintCache = (root: string): EslintCacheSession => {
  const { inputs } = contract(root)
  let temporary: string | undefined

  try {
    const directory = cacheDirectory(root)
    const key = eslintCacheFingerprint(root, inputs)
    const saved = join(directory, 'cache.json')
    const payload = readCache(saved, key)

    temporary = mkdtempSync(join(directory, 'run-'))

    const native = join(temporary, 'native-cache')
    const pending = join(temporary, 'cache.json')
    const work = temporary

    if (payload !== undefined) writeFileSync(native, payload, { mode: 0o600 })

    return {
      flags: ['--cache', '--cache-strategy', 'content', '--cache-location', native],
      finish: () => {
        if (eslintCacheFingerprint(root, inputs) !== key)
          throw new EngineError('ESLint cache inputs changed during the check. Run the check again on stable inputs.', {
            command: 'eslint --cache'
          })

        if (!existsSync(native)) return

        const next = readFileSync(native, 'utf8')

        // Native cache serialization is private to ESLint. Preserve its bytes and only check JSON integrity.
        JSON.parse(next)

        const record: CacheRecord = { version: 1, key, checksum: hash(next), payload: next }

        writeFileSync(pending, JSON.stringify(record), { mode: 0o600 })
        renameSync(pending, saved)
      },
      dispose: () => dispose(work)
    }
  } catch (cause) {
    if (temporary) dispose(temporary)

    if (cause instanceof EngineError) throw cause

    const reason =
      cause instanceof Error && cause.message === LIMIT
        ? LIMIT
        : 'ESLint cache inputs or storage could not be read safely. Check the declared paths and cache ownership, or run without --eslint-cache.'

    throw new EngineError(reason, { command: 'eslint --cache', cause })
  }
}
