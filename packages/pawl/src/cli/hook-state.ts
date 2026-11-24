/**
 * What pawl's hooks remember within one agent session: the files the agent edited, so the stop
 * hook checks the agent's own work and not the rest of the working tree, and how often the stop
 * hook has sent the agent back. It lives in a private per-user folder under the temporary folder
 * on POSIX, or the user profile on Windows, with one pair of files per project and session.
 * Losing it costs nothing worse than a stop hook that lets the agent finish.
 */

import { createHash } from 'node:crypto'
import {
  appendFileSync,
  closeSync,
  constants,
  fstatSync,
  ftruncateSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  type Stats,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { isRecord } from '../utils/json.ts'

/** How often the stop hook sent the agent back in a row, and what it found the last time. */
export interface StopState {
  rounds: number
  signature: string
}

/** The folder of the hooks' state. Tests pass their own. */
export const HOOK_STATE_DIR = process.getuid
  ? join(tmpdir(), `pawl-hooks-${process.getuid()}`)
  : join(homedir(), '.pawl-hooks')

/** Windows inherits the user profile's ACL; Node's mode and uid cannot validate that ACL. */
const privateOwner = (state: Stats, uid: number | undefined): boolean =>
  uid === undefined || (state.uid === uid && (state.mode & 0o077) === 0)

/** Resolve trusted parents, then refuse an existing public, foreign-owned or linked state folder. */
const privateDirectory = (dir: string, create: boolean): string | undefined => {
  const uid = process.getuid?.()

  const parent = realpathSync(dirname(dir))
  let ancestor = parent

  while (true) {
    const state = lstatSync(ancestor)

    if (
      !state.isDirectory() ||
      (uid !== undefined &&
        ((state.uid !== uid && state.uid !== 0) || ((state.mode & 0o022) !== 0 && (state.mode & 0o1000) === 0)))
    )
      return undefined

    const next = dirname(ancestor)

    if (next === ancestor) break

    ancestor = next
  }

  const path = join(parent, basename(dir))

  if (create) {
    try {
      mkdirSync(path, { mode: 0o700 })
    } catch (error) {
      if (!isRecord(error) || error.code !== 'EEXIST') throw error
    }
  }

  const state = lstatSync(path)

  return state.isDirectory() && privateOwner(state, uid) ? path : undefined
}

/** Validate the opened inode before reading or changing it; never truncate through a path. */
const withStateFile = <T>(
  dir: string,
  file: string,
  write: boolean,
  action: (descriptor: number, path: string) => T,
  retry = true
): T | undefined => {
  let descriptor: number | undefined

  try {
    const directory = privateDirectory(dir, write)
    const uid = process.getuid?.()

    if (directory === undefined) return undefined

    const path = join(directory, basename(file))
    let before: Stats | undefined

    try {
      before = lstatSync(path)
    } catch (error) {
      if (!isRecord(error) || error.code !== 'ENOENT') throw error
    }

    if (before && (!before.isFile() || !privateOwner(before, uid) || before.nlink !== 1)) return undefined

    const access = write ? constants.O_WRONLY | constants.O_APPEND : constants.O_RDONLY
    const create = write && before === undefined ? constants.O_CREAT | constants.O_EXCL : 0

    try {
      descriptor = openSync(path, access | create | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0), 0o600)
    } catch (error) {
      // Two edit hooks may create the same log together. Validate the winner's file on one retry.
      if (retry && create !== 0 && isRecord(error) && error.code === 'EEXIST')
        return withStateFile(dir, file, write, action, false)

      throw error
    }

    const state = fstatSync(descriptor)

    if (
      !state.isFile() ||
      !privateOwner(state, uid) ||
      state.nlink !== 1 ||
      (before !== undefined && (state.dev !== before.dev || state.ino !== before.ino))
    )
      return undefined

    return action(descriptor, path)
  } catch {
    // Unavailable or unsafe state must never modify another file or prevent the hook from exiting.
    return undefined
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

/** One name per project and session, so two repos or two sessions never share their state. */
const keyOf = (root: string, session: string): string =>
  createHash('sha256').update(`${root}\0${session}`).digest('hex').slice(0, 32)

const editsFile = (dir: string, root: string, session: string): string => join(dir, `${keyOf(root, session)}.edits`)

const stopFile = (dir: string, root: string, session: string): string => join(dir, `${keyOf(root, session)}.stop.json`)

/**
 * Add the files an edit touched, as project paths. Appending one short write at a time keeps the
 * list whole when an agent's edits run their hooks at the same time.
 */
export const recordEdits = (root: string, session: string, files: readonly string[], dir = HOOK_STATE_DIR): void => {
  if (files.length === 0) return

  withStateFile(dir, editsFile(dir, root, session), true, descriptor => {
    appendFileSync(descriptor, files.map(file => `${file}\n`).join(''))
  })
}

/** The files the agent edited in this session, each once. */
export const editedFiles = (root: string, session: string, dir = HOOK_STATE_DIR): string[] =>
  withStateFile(dir, editsFile(dir, root, session), false, descriptor => {
    const lines = readFileSync(descriptor, 'utf8').split('\n')

    return [...new Set(lines.filter(line => line.length > 0))]
  }) ?? []

export const readStopState = (root: string, session: string, dir = HOOK_STATE_DIR): StopState | undefined =>
  withStateFile(dir, stopFile(dir, root, session), false, descriptor => {
    const value: unknown = JSON.parse(readFileSync(descriptor, 'utf8'))

    if (isRecord(value) && typeof value.rounds === 'number' && typeof value.signature === 'string') {
      return { rounds: value.rounds, signature: value.signature }
    }
  })

export const writeStopState = (root: string, session: string, state: StopState, dir = HOOK_STATE_DIR): void => {
  withStateFile(dir, stopFile(dir, root, session), true, descriptor => {
    ftruncateSync(descriptor, 0)
    writeFileSync(descriptor, JSON.stringify(state))
  })
}

/** Forget the session once the agent has finished: its next turn starts with no edits. */
export const clearSession = (root: string, session: string, dir = HOOK_STATE_DIR): void => {
  for (const file of [editsFile(dir, root, session), stopFile(dir, root, session)]) {
    withStateFile(dir, file, false, (_descriptor, path) => unlinkSync(path))
  }
}
