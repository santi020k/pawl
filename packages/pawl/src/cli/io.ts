/** What the CLI prints, and the one other program it runs: the package manager. */

import { spawn, spawnSync } from 'node:child_process'

/** Print a block of text. Empty text prints nothing, not a blank line. */
export const out = (text: string): void => {
  if (text.length > 0) process.stdout.write(`${text}\n`)
}

/** The notes of a plan, one line each. */
export const printNotes = (notes: readonly string[]): void => {
  for (const note of notes) out(`Note: ${note}`)
}

/** End a dry run: the notes, and the reminder that nothing was written. */
export const endDryRun = (notes: readonly string[]): void => {
  out(['', ...notes.map(note => `Note: ${note}`), '', 'Dry run. Nothing was changed.'].join('\n'))
}

/** The programs an install command runs, one after the other: one, or two joined by `&&`. */
const steps = (command: string): [string, ...string[]][] =>
  command.split(' && ').map(step => step.split(' ') as [string, ...string[]])

/** Run the package manager. Returns false, with the command to run by hand, when it fails. */
export const runInstall = (root: string, command: string): boolean => {
  const ok = steps(command).every(
    ([program, ...args]) =>
      spawnSync(program, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' }).status === 0
  )

  if (!ok) out(`\nCould not install automatically. Run this yourself:\n  ${command}`)

  return ok
}

/** What a quiet install printed, and whether it worked. */
export interface Installed {
  ok: boolean
  /** What the package manager printed, stdout and stderr as they came. */
  output: string
}

/**
 * Run the package manager without showing what it prints, for a spinner to stand in for it, or
 * for a coding agent that only needs to hear when it failed.
 */
export const installQuietly = async (root: string, command: string): Promise<Installed> => {
  const output: string[] = []

  for (const [program, ...args] of steps(command)) {
    const step = await new Promise<Installed>(resolvePromise => {
      const chunks: string[] = []
      const child = spawn(program, args, {
        cwd: root,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: process.platform === 'win32'
      })

      child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk.toString()))
      child.stderr.on('data', (chunk: Buffer) => chunks.push(chunk.toString()))
      child.on('error', error => resolvePromise({ ok: false, output: error.message }))
      child.on('close', code => resolvePromise({ ok: code === 0, output: chunks.join('') }))
    })

    output.push(step.output)

    if (!step.ok) return { ok: false, output: output.join('') }
  }

  return { ok: true, output: output.join('') }
}

/** The last lines of a program's output, for when it failed. */
export const tail = (output: string, count = 12): string[] => output.trimEnd().split(/\r?\n/).slice(-count)
