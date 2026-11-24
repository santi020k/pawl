/**
 * What pawl's hooks remember within one agent session: the files the agent edited, so the stop
 * hook checks the agent's own work and not the rest of the working tree, and how often the stop
 * hook has sent the agent back. It lives in the system's temporary folder, one pair of files per
 * project and session. Losing it costs nothing worse than a stop hook that lets the agent finish.
 */

import { createHash } from 'node:crypto'
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isRecord } from '../utils/json.ts'

/** How often the stop hook sent the agent back in a row, and what it found the last time. */
export interface StopState {
  rounds: number
  signature: string
}

/** The folder of the hooks' state. Tests pass their own. */
export const HOOK_STATE_DIR = join(tmpdir(), 'pawl-hooks')

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

  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    appendFileSync(editsFile(dir, root, session), files.map(file => `${file}\n`).join(''))
  } catch {
    // Without a place to write, the stop hook has nothing to check and lets the agent finish.
  }
}

/** The files the agent edited in this session, each once. */
export const editedFiles = (root: string, session: string, dir = HOOK_STATE_DIR): string[] => {
  try {
    const lines = readFileSync(editsFile(dir, root, session), 'utf8').split('\n')

    return [...new Set(lines.filter(line => line.length > 0))]
  } catch {
    return []
  }
}

export const readStopState = (root: string, session: string, dir = HOOK_STATE_DIR): StopState | undefined => {
  try {
    const value: unknown = JSON.parse(readFileSync(stopFile(dir, root, session), 'utf8'))

    if (isRecord(value) && typeof value.rounds === 'number' && typeof value.signature === 'string') {
      return { rounds: value.rounds, signature: value.signature }
    }
  } catch {
    // No state yet, or a file that is not pawl's: start again from the first round.
  }

  return undefined
}

export const writeStopState = (root: string, session: string, state: StopState, dir = HOOK_STATE_DIR): void => {
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    writeFileSync(stopFile(dir, root, session), JSON.stringify(state))
  } catch {
    // The next stop then counts from the first round, and the round limit still holds per chain.
  }
}

/** Forget the session once the agent has finished: its next turn starts with no edits. */
export const clearSession = (root: string, session: string, dir = HOOK_STATE_DIR): void => {
  try {
    rmSync(editsFile(dir, root, session), { force: true })
    rmSync(stopFile(dir, root, session), { force: true })
  } catch {
    // A file pawl cannot remove is checked again at the next stop, which is safe.
  }
}
