/** Opt-in native ESLint caching with a project-wide deterministic-input contract. */
import { createHash, type Hash } from 'node:crypto'
import {
  closeSync,
  constants,
  type Dirent,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
  type Stats,
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
const HASH_CHUNK_BYTES = 64 * 1024
const READ_FILE_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)
const FILE_CHANGED = 'ESLint cache input changed while hashing.'
const NOT_REGULAR = 'An ESLint cache input is not a regular file, directory or symbolic link.'
const LIMIT = 'ESLint cache inputs exceed the bounded snapshot. Run without --eslint-cache or reduce the input tree.'

interface Contract {
  inputs: string[]
}

type EntryKind = 'file' | 'directory' | 'symlink'

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

const compareEntries = (a: Dirent, b: Dirent): number => {
  if (a.name < b.name) return -1

  return a.name > b.name ? 1 : 0
}

const direntKind = (entry: Dirent): EntryKind | undefined => {
  if (entry.isSymbolicLink()) return 'symlink'

  if (entry.isDirectory()) return 'directory'

  return entry.isFile() ? 'file' : undefined
}

const lstatOptional = (path: string): Stats | undefined => {
  try {
    return lstatSync(path)
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return undefined

    throw error
  }
}

/**
 * Stream one regular file into the fingerprint digest using a reusable chunk buffer, refusing
 * symlinks, non-regular files (such as FIFOs) and concurrent size changes.
 */
export const hashRegularFile = (
  path: string,
  digest: Hash,
  chunk: Buffer,
  remainingBytes: number,
  onChunk?: () => void
): number => {
  const fd = openSync(path, READ_FILE_FLAGS)

  try {
    const stat = fstatSync(fd)

    if (!stat.isFile()) throw new Error(NOT_REGULAR)

    if (stat.size > remainingBytes) throw new Error(LIMIT)

    add(digest, `file:${stat.mode}`)
    digest.update(`${stat.size}:`)

    let total = 0

    for (;;) {
      const count = readSync(fd, chunk, 0, chunk.length, null)

      if (count === 0) break

      total += count

      if (total > stat.size) throw new Error(FILE_CHANGED)

      if (total > remainingBytes) throw new Error(LIMIT)

      digest.update(count === chunk.length ? chunk : chunk.subarray(0, count))
      onChunk?.()
    }

    if (total !== stat.size) throw new Error(FILE_CHANGED)

    return total
  } finally {
    closeSync(fd)
  }
}

const readRegularTextFile = (path: string, maxBytes = MAX_BYTES): string => {
  const fd = openSync(path, READ_FILE_FLAGS)

  try {
    const stat = fstatSync(fd)

    if (!stat.isFile()) throw new Error(NOT_REGULAR)

    if (stat.size > maxBytes) throw new Error(LIMIT)

    const chunk = Buffer.allocUnsafe(Math.min(Math.max(stat.size, 1), HASH_CHUNK_BYTES))
    const parts: Buffer[] = []
    let total = 0

    for (;;) {
      const count = readSync(fd, chunk, 0, chunk.length, null)

      if (count === 0) break

      total += count

      if (total > stat.size || total > maxBytes) throw new Error(FILE_CHANGED)

      parts.push(Buffer.from(chunk.subarray(0, count)))
    }

    if (total !== stat.size) throw new Error(FILE_CHANGED)

    return Buffer.concat(parts, total).toString('utf8')
  } finally {
    closeSync(fd)
  }
}

/** Include every Node resolution ancestor, including the dependencies beside a pnpm symlink target. */
const resolutionInputs = (start: string, seenDirs?: Set<string>): string[] => {
  const paths: string[] = []
  let dir = resolve(start)

  for (;;) {
    if (seenDirs?.has(dir)) return paths

    seenDirs?.add(dir)
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
  const seenResolutionDirs = new Set<string>()
  const chunk = Buffer.allocUnsafe(HASH_CHUNK_BYTES)
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

  const walk = (path: string, knownKind?: EntryKind): void => {
    const absolute = resolve(path)

    if (absolute === output || absolute.startsWith(`${output}${sep}`)) return

    add(digest, absolute)

    if (seen.has(absolute)) return

    seen.add(absolute)

    if (++files > MAX_FILES) throw new Error(LIMIT)

    let kind = knownKind

    if (kind === undefined) {
      const stat = lstatOptional(absolute)

      if (!stat) {
        add(digest, 'missing')

        return
      }

      if (stat.isSymbolicLink()) kind = 'symlink'
      else if (stat.isDirectory()) kind = 'directory'
      else if (stat.isFile()) kind = 'file'
      else throw new Error(NOT_REGULAR)
    }

    if (kind === 'symlink') {
      const target = realpathSync(absolute)

      add(digest, `link:${target}`)
      walk(target)

      for (const input of resolutionInputs(dirname(target), seenResolutionDirs)) walk(input)
    } else if (kind === 'directory') {
      add(digest, 'directory')

      const entries = readdirSync(absolute, { withFileTypes: true }).sort(compareEntries)

      for (const entry of entries) walk(join(absolute, entry.name), direntKind(entry))
    } else {
      bytes += hashRegularFile(absolute, digest, chunk, MAX_BYTES - bytes)
    }
  }

  walk(root)
  walk(process.execPath)

  for (const input of [
    ...resolutionInputs(dirname(root), seenResolutionDirs),
    ...external.map(path => resolve(root, path))
  ].sort())
    walk(input)

  return digest.digest('hex')
}

/** Refuse links or unknown data in the cache namespace; do not overwrite a user's files. */
const cacheDirectory = (root: string): string => {
  const directory = join(root, DIRECTORY)

  for (const path of [join(root, '.pawl'), join(root, '.pawl/cache'), directory]) {
    const stat = lstatOptional(path)

    if (stat && (!stat.isDirectory() || stat.isSymbolicLink()))
      throw new Error('The ESLint cache directory must be a regular directory, not a symbolic link.')
  }

  mkdirSync(directory, { recursive: true })

  const owner = join(directory, 'owner.json')
  const expected = '{"pawlEslintCache":1}\n'

  // A check that starts at the same time may take the directory between these steps. Its owner
  // file is then there, and is read as any other.
  if (!lstatOptional(owner)) {
    const entries = readdirSync(directory)

    if (!entries.includes('owner.json')) {
      if (entries.length > 0) throw new Error('The ESLint cache directory contains unowned files.')

      try {
        writeFileSync(owner, expected, { flag: 'wx', mode: 0o600 })

        return directory
      } catch (error) {
        if (!isRecord(error) || error.code !== 'EEXIST') throw error
      }
    }
  }

  let text = ''

  try {
    text = readRegularTextFile(owner, 1024)
  } catch (cause) {
    throw new Error('The ESLint cache directory has unrecognized ownership metadata.', { cause })
  }

  if (text !== expected) {
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
    const value: unknown = JSON.parse(readRegularTextFile(path, MAX_BYTES))

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

        if (!lstatOptional(native)) return

        const next = readRegularTextFile(native, MAX_BYTES)

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
