#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { EXIT_OK, EXIT_SETUP } from './check/result.ts'
import { type Flags, helpText, OPTIONS, unknownCommand, usageFrom } from './cli/args.ts'
import { terminal } from './cli/audience.ts'
import { runAdd } from './cli/commands/add.ts'
import { checkRoot, runBaseline, runCheck } from './cli/commands/check.ts'
import { runDoctor } from './cli/commands/doctor.ts'
import { runExplain } from './cli/commands/explain.ts'
import { runInit } from './cli/commands/init.ts'
import { runMigrate } from './cli/commands/migrate.ts'
import { runSync } from './cli/commands/sync.ts'
import { runUpgrade } from './cli/commands/upgrade.ts'
import { out } from './cli/io.ts'
import { CancelledError } from './cli/prompt.ts'
import { VERSION } from './version.ts'

/** Ctrl+C or Escape at a question: nothing was changed, and the shell's code for an interrupt. */
const EXIT_CANCELLED = 130

interface Invocation {
  root: string
  /** What follows the command: files, pack names or a rule. */
  args: string[]
  flags: Flags
}

/** Every command, by the name typed after `pawl`. */
const COMMANDS: Readonly<Record<string, (invocation: Invocation) => Promise<number>>> = {
  init: ({ root, flags }) => runInit(root, flags),
  check: ({ root, args, flags }) => runCheck(root, args, flags, false),
  fix: ({ root, args, flags }) => runCheck(root, args, flags, true),
  // Like the check, these work on the root pawl was set up in, not on a package folder inside it.
  sync: ({ root, flags }) => runSync(checkRoot(root), flags),
  upgrade: ({ root, flags }) => runUpgrade(checkRoot(root), flags),
  add: ({ root, args, flags }) => runAdd(checkRoot(root), args, flags),
  migrate: ({ root, flags }) => runMigrate(root, flags),
  baseline: ({ root }) => runBaseline(root),
  explain: ({ root, args }) => runExplain(root, args[0]),
  doctor: ({ root, flags }) => runDoctor(checkRoot(root), flags)
}

const parse = (): ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>> => {
  try {
    return parseArgs({ options: OPTIONS, allowPositionals: true })
  } catch (error) {
    throw usageFrom(error)
  }
}

const main = async (): Promise<number> => {
  const { values: flags, positionals } = parse()
  const [command, ...rest] = positionals
  const root = process.cwd()
  const term = terminal()

  if (flags.version) {
    out(VERSION)

    return EXIT_OK
  }

  if (flags.help || command === undefined || command === 'help') {
    // "pawl help check" and "pawl check --help" both show the help of check.
    const topic = command === 'help' ? rest[0] : command

    process.stdout.write(helpText(topic, term.rich ? term.style : undefined))

    return EXIT_OK
  }

  // Own keys only, so a name such as "constructor" is an unknown command too.
  const run = Object.hasOwn(COMMANDS, command) ? COMMANDS[command] : undefined

  if (!run) throw unknownCommand(command)

  return run({ root, args: rest, flags })
}

try {
  process.exitCode = await main()
} catch (error) {
  const { rich, style, sym } = terminal()

  if (error instanceof CancelledError) {
    if (rich) process.stdout.write(`${style.gray(sym.barEnd)}  Cancelled. Nothing was changed.\n\n`)
    else process.stderr.write('pawl: Cancelled. Nothing was changed.\n')

    process.exitCode = EXIT_CANCELLED
  } else {
    const message = error instanceof Error ? error.message : String(error)

    process.stderr.write(rich ? `${style.red(sym.cross)} ${style.red(message)}\n` : `pawl: ${message}\n`)
    process.exitCode = EXIT_SETUP
  }
}
