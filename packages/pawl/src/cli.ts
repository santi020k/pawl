#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { EXIT_OK, EXIT_SETUP } from './check/result.ts'
import { type Flags, HELP, OPTIONS, UsageError } from './cli/args.ts'
import { runAdd } from './cli/commands/add.ts'
import { runBaseline, runCheck } from './cli/commands/check.ts'
import { runDoctor } from './cli/commands/doctor.ts'
import { runExplain } from './cli/commands/explain.ts'
import { runInit } from './cli/commands/init.ts'
import { runMigrate } from './cli/commands/migrate.ts'
import { runSync } from './cli/commands/sync.ts'
import { out } from './cli/io.ts'
import { VERSION } from './version.ts'

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
  sync: ({ root, flags }) => runSync(root, flags),
  add: ({ root, args, flags }) => runAdd(root, args, flags),
  migrate: ({ root, flags }) => runMigrate(root, flags),
  baseline: ({ root }) => runBaseline(root),
  explain: ({ root, args }) => runExplain(root, args[0]),
  doctor: ({ root, flags }) => runDoctor(root, flags)
}

const main = async (): Promise<number> => {
  const { values: flags, positionals } = parseArgs({ options: OPTIONS, allowPositionals: true })
  const [command, ...rest] = positionals
  const root = process.cwd()

  if (flags.version) {
    out(VERSION)

    return EXIT_OK
  }

  if (flags.help || command === undefined || command === 'help') {
    out(HELP)

    return EXIT_OK
  }

  // Own keys only, so a name such as "constructor" is an unknown command too.
  const run = Object.hasOwn(COMMANDS, command) ? COMMANDS[command] : undefined

  if (!run) throw new UsageError(`Unknown command "${command}". Run "pawl --help".`)

  return run({ root, args: rest, flags })
}

try {
  process.exitCode = await main()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)

  process.stderr.write(`pawl: ${message}\n`)
  process.exitCode = EXIT_SETUP
}
