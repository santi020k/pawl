/** What the CLI prints, and the one other program it runs: the package manager. */

import { spawnSync } from 'node:child_process'

/** Print a block of text. Empty text prints nothing, not a blank line. */
export const out = (text: string): void => {
  if (text.length > 0) process.stdout.write(`${text}\n`)
}

/** Colors only on a terminal, and never when NO_COLOR is set. */
export const colorEnabled = (): boolean => process.stdout.isTTY === true && process.env.NO_COLOR === undefined

/** The notes of a plan, one line each. */
export const printNotes = (notes: readonly string[]): void => {
  for (const note of notes) out(`Note: ${note}`)
}

/** End a dry run: the notes, and the reminder that nothing was written. */
export const endDryRun = (notes: readonly string[]): void => {
  out(['', ...notes.map(note => `Note: ${note}`), '', 'Dry run. Nothing was changed.'].join('\n'))
}

/** Run the package manager. Returns false, with the command to run by hand, when it fails. */
export const runInstall = (root: string, command: string): boolean => {
  const [program, ...args] = command.split(' ') as [string, ...string[]]
  const ok = spawnSync(program, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' }).status === 0

  if (!ok) out(`\nCould not install automatically. Run this yourself:\n  ${command}`)

  return ok
}
