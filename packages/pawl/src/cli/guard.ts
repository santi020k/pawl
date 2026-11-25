/**
 * The guard on the ratchet, run from a coding agent's hook before each tool call. An agent that
 * cannot make a check pass can make it stop failing instead: record the findings with
 * `pawl baseline`, edit `.pawl/baseline.json`, or loosen the policy or an engine config. Each of
 * those is a person's decision, so the guard hands it to one: Claude Code and Copilot ask the
 * person, and Codex, which cannot ask, refuses a change to the baseline and says why. `init
 * --agents` writes it for Claude Code and Codex only: Copilot refuses a tool when a hook before it
 * fails, as `npx --no pawl` does before the install, so a Copilot guard is for a hook set up by hand.
 *
 * The guard only reads the payload. It loads no project and runs no engine, because it runs
 * before every edit and every shell command the agent makes.
 */

import { existsSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, posix, resolve } from 'node:path'
import { BASELINE_FILE } from '../check/baseline.ts'
import {
  BIOME_CONFIG_FILES,
  ESLINT_CONFIG_FILES,
  OXLINT_CONFIG_FILES,
  PAWL_CONFIG_FILES,
  PRETTIER_CONFIG_FILES
} from '../project/config-files.ts'
import { projectPath } from '../project/files.ts'
import { isRecord } from '../utils/json.ts'
import { type ShellCommand, shellCommands } from '../utils/shell.ts'

/**
 * Which host is asking, which decides the answer: Claude Code and Copilot can ask the person;
 * Codex parses "ask" but does not support it yet, so it gets a refusal or nothing.
 */
export type GuardHost = 'claude' | 'codex' | 'copilot'

/** A tool call an agent is about to make. */
export interface GuardPayload {
  host: GuardHost
  /** The files the tool writes, moves or deletes, as the payload names them. */
  files: string[]
  /** The shell command, for a tool that runs one. */
  command?: string
  /** The folder the agent's relative paths start from, when the payload says. */
  cwd?: string
}

/** What the guard found in a tool call. */
export interface GuardFinding {
  /** The project files the tool would change that decide what the ratchet allows. */
  files: string[]
  /** The baseline itself, or `pawl baseline`, which rewrites it: what Codex refuses. */
  baseline: boolean
  /** The command runs `pawl baseline`. */
  records: boolean
}

const parse = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

const PATH_FIELDS = ['file_path', 'filePath', 'path', 'notebook_path'] as const

/** Every file an `apply_patch` patch adds, updates, deletes or moves to. */
const PATCH_FILES = /^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm

const stringsIn = (value: unknown): string[] => {
  if (typeof value === 'string') return [value]

  if (Array.isArray(value)) return value.flatMap(stringsIn)

  return isRecord(value) ? Object.values(value).flatMap(stringsIn) : []
}

const pathsIn = (input: unknown): string[] => {
  if (!isRecord(input)) return []

  const edits = Array.isArray(input.replacements) ? input.replacements : []

  return [input, ...edits]
    .flatMap(item => (isRecord(item) ? PATH_FIELDS.map(field => item[field]) : []))
    .filter((path): path is string => typeof path === 'string' && path.length > 0)
}

/**
 * Read the payload of a hook that runs before a tool: `PreToolUse` in Claude Code and Codex, and
 * Copilot's own `preToolUse`, which names no event, has `toolName` and `toolArgs`, and has no
 * `toolResult` yet. Copilot's payload after a tool looks the same when a host leaves the result
 * out, so it is only read as one before a tool from the guard's command, `check --hook`, never
 * from the edit hook's `fix --hook`. Undefined for any other payload.
 */
export const readGuardPayload = (
  text: string,
  { env = process.env, copilot = true }: { env?: Readonly<Record<string, string | undefined>>; copilot?: boolean } = {}
): GuardPayload | undefined => {
  const payload = parse(text)

  if (!isRecord(payload)) return undefined

  const claudeShape = payload.hook_event_name === 'PreToolUse'
  const copilotShape =
    copilot &&
    payload.hook_event_name === undefined &&
    typeof payload.toolName === 'string' &&
    !('toolResult' in payload) &&
    !('stopReason' in payload)

  if (!claudeShape && !copilotShape) return undefined

  // Codex sends Claude Code's shape, with the turn it is in, and runs its hooks with its own variables.
  const codex = claudeShape && ('turn_id' in payload || env.CODEX_THREAD_ID !== undefined)
  let host: GuardHost = codex ? 'codex' : 'claude'

  if (copilotShape) host = 'copilot'
  const tool = claudeShape ? payload.tool_name : payload.toolName
  const args = typeof payload.toolArgs === 'string' ? (parse(payload.toolArgs) ?? payload.toolArgs) : payload.toolArgs
  const input = claudeShape ? payload.tool_input : args
  const patch = tool === 'apply_patch'
  const files = patch
    ? stringsIn(input).flatMap(text => [...text.matchAll(PATCH_FILES)].map(match => (match[1] ?? '').trim()))
    : pathsIn(input)
  const command = !patch && isRecord(input) && typeof input.command === 'string' ? input.command : undefined
  const cwd = typeof payload.cwd === 'string' && payload.cwd.length > 0 ? { cwd: payload.cwd } : {}

  return { host, files: [...new Set(files)], ...(command === undefined ? {} : { command }), ...cwd }
}

/** The files whose changes decide what the ratchet allows, by name, wherever they are in the project. */
const GUARDED = new Set([
  ...PAWL_CONFIG_FILES,
  ...BIOME_CONFIG_FILES,
  ...ESLINT_CONFIG_FILES,
  ...OXLINT_CONFIG_FILES,
  ...PRETTIER_CONFIG_FILES
])

/** The folder the baseline is in: a command that removes or replaces it changes the baseline. */
const BASELINE_FOLDER = posix.dirname(BASELINE_FILE)

const isBaseline = (path: string): boolean => path === BASELINE_FILE || path.endsWith(`/${BASELINE_FILE}`)

const guarded = (path: string): boolean => isBaseline(path) || GUARDED.has(posix.basename(path))

/** A path as a POSIX shell or PowerShell on Windows names it, with forward slashes. */
const slashes = (path: string): string => path.replaceAll('\\', '/')

/**
 * The top of the repository the project is in. Agents start their hooks in the folder they work
 * in, which in a monorepo can be a package, and the baseline and the policy are still at the top.
 * Outside a repository, the folder pawl runs in.
 */
const repositoryRoot = (root: string): string => {
  for (let dir = resolve(root); ; dir = dirname(dir)) {
    if (existsSync(join(dir, '.git'))) return dir

    if (dirname(dir) === dir) return root
  }
}

/** pawl however a command names it: `pawl`, `node_modules/.bin/pawl`, `@santi020k/pawl@0.6.0`, `pawl.cmd`, `…/pawl/dist/cli.js`. */
const PAWL_PROGRAM =
  /(?:^|\/)(?:pawl(?:@[^/]*)?|pawl\.(?:cmd|ps1|exe)|@santi020k\/pawl(?:@[^/]*)?|pawl\/(?:dist|src)\/cli\.[cm]?[jt]s)$/i

/** `pawl baseline`: pawl, then `baseline` as the first word after it that is not an option. */
const recordsBaseline = ({ words }: ShellCommand): boolean =>
  words.some(
    (word, index) =>
      PAWL_PROGRAM.test(slashes(word)) && words.slice(index + 1).find(item => !item.startsWith('-')) === 'baseline'
  )

/** Words that run the command after them: `sudo rm …`, `env A=1 tee …`, `xargs rm`. */
const WRAPPERS = new Set(['sudo', 'env', 'command', 'exec', 'time', 'nice', 'xargs', 'timeout'])

const nameOf = (word: string): string => (slashes(word).split('/').pop() ?? '').toLowerCase().replace(/\.exe$/, '')

/** The program a simple command runs, by its name in lower case, and the words after it. */
const programOf = (words: readonly string[]): { name: string; args: string[] } => {
  let index = 0
  let wrapped = false

  while (index < words.length) {
    const word = words[index] as string

    if (/^[A-Za-z_]\w*=/.test(word) || (wrapped && /^(?:-|\d)/.test(word))) {
      index++
    } else if (WRAPPERS.has(nameOf(word))) {
      wrapped = true
      index++
    } else {
      break
    }
  }

  return { name: nameOf(words[index] ?? ''), args: words.slice(index + 1) }
}

/** Programs that write, move or remove every file they name: in a POSIX shell, and PowerShell's cmdlets with their aliases. */
const WRITE_ALL = new Set([
  'tee',
  'truncate',
  'sponge',
  'rm',
  'unlink',
  'shred',
  'mv',
  'del',
  'erase',
  'ri',
  'remove-item',
  'set-content',
  'sc',
  'add-content',
  'ac',
  'clear-content',
  'clc',
  'out-file',
  'new-item',
  'ni',
  'move-item',
  'mi',
  'move',
  'rename-item',
  'rni',
  'ren'
])

/** Programs that write the last file they name, or into the folder after `-t` or `-Destination`. */
const WRITE_LAST = new Set(['cp', 'copy', 'cpi', 'copy-item', 'install', 'ln', 'rsync'])

/** Programs that edit the files they name in place with `-i`: `sed -i`, `perl -pi -e`, `yq -i`. */
const IN_PLACE = new Set(['sed', 'perl', 'ruby', 'yq'])

/** Programs that run a script given after `-e` or `-c`, or as a here-document. */
const INTERPRETERS = new Set(['node', 'nodejs', 'deno', 'bun', 'python', 'python3', 'py', 'perl', 'ruby', 'php'])

/** git commands that write the files they name from another commit, or remove them. */
const GIT_WRITES = new Set(['checkout', 'restore', 'rm', 'mv'])

/** What in a script can write a file, read loosely: `writeFileSync`, `open(…, 'w')`, `json.dump`, `rename`. */
const SCRIPT_WRITES = /write|dump|rename|unlink|rmSync|copyFile|truncate|open\s*\([^)]*['"][wax]/i

/** Every file a unified diff changes, as `git apply` or `patch` reads it. */
const DIFF_FILES = /^(?:\+\+\+|---) (?:[ab]\/)?(\S+)/gm

const matches = (text: string, pattern: RegExp): string[] =>
  [...text.matchAll(pattern)].map(match => (match[1] ?? '').trim()).filter(file => file !== '/dev/null')

const operands = (args: readonly string[]): string[] => args.filter(arg => !arg.startsWith('-'))

/** The words of a script that could be a file it names. */
const namedIn = (script: string): string[] => script.split(/[\s'"`(),;=[\]{}]+/).filter(Boolean)

/** The git command after its own options, such as `-C <path>`. */
const gitCommand = (args: readonly string[]): { name: string; args: string[] } => {
  let index = 0

  while (index < args.length && (args[index] as string).startsWith('-'))
    index += /^-[Cc]$/.test(args[index] as string) ? 2 : 1

  return { name: (args[index] ?? '').toLowerCase(), args: args.slice(index + 1) }
}

/** The pathspecs a git command that rewrites working-tree files names: `git restore .`, `git checkout main -- src`. */
const gitPathspecs = (command: ShellCommand): string[] => {
  const { name, args } = programOf(command.words)

  if (name !== 'git') return []

  const git = gitCommand(args)

  return GIT_WRITES.has(git.name) ? operands(git.args) : []
}

const isDirectory = (path: string): boolean => {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** A glob in a pathspec: what follows it can match any file in the folder before it. */
const GLOB = /[*?[]/

/**
 * The guarded files a pathspec covers when it names a folder or a pattern, not one file: `.`,
 * `.pawl/`, `:/`, `src/*`. A pathspec with any other magic, such as `:!docs`, covers the whole
 * repository, because the guard does not read it further. The guarded files of the folder are the
 * ones it has, and the baseline of the repository when the folder holds it, even if it is gone.
 */
const coveredBy = (top: string, base: string, pathspec: string): string[] => {
  let spec = slashes(pathspec)
  let from = base

  if (spec.startsWith(':/')) {
    spec = spec.slice(2)
    from = top
  } else if (spec.startsWith(':(top)')) {
    spec = spec.slice(':(top)'.length)
    from = top
  } else if (spec.startsWith(':')) {
    spec = ''
    from = top
  }

  const glob = spec.search(GLOB)
  const prefix = glob === -1 ? spec : spec.slice(0, spec.lastIndexOf('/', glob) + 1)
  const dir = isAbsolute(prefix) ? prefix : resolve(from, prefix || '.')

  if (glob === -1 && spec !== '' && !isDirectory(dir)) return []

  const baseline = join(top, BASELINE_FILE)
  const holdsBaseline = projectPath(dir, baseline) !== undefined
  const candidates = [BASELINE_FILE, ...GUARDED].map(file => join(dir, file)).filter(file => existsSync(file))

  return holdsBaseline ? [baseline, ...candidates] : candidates
}

/** The files one simple command writes, moves or removes, as it names them. */
const writtenBy = (command: ShellCommand): string[] => {
  const { name, args } = programOf(command.words)
  const paths = operands(args)
  const files = [...command.writes]

  if (WRITE_ALL.has(name)) files.push(...paths)

  if (WRITE_LAST.has(name)) {
    const flag = args.findIndex(arg => /^(?:-t|--target-directory|-destination)$/i.test(arg))
    const target = flag === -1 ? paths.at(-1) : args[flag + 1]

    if (target !== undefined) {
      files.push(target)

      // A folder takes the names of what is copied into it: `cp /tmp/baseline.json .pawl/`.
      if (flag !== -1 || /[\\/]$/.test(target) || target === '.' || nameOf(target) === BASELINE_FOLDER)
        files.push(...paths.filter(path => path !== target).map(path => `${target}/${slashes(path).split('/').pop()}`))
    }
  }

  if (IN_PLACE.has(name) && args.some(arg => /^-[a-zA-Z]*i/.test(arg) || /^--in-?place/.test(arg))) files.push(...paths)

  if (name === 'dd') files.push(...args.flatMap(arg => (arg.startsWith('of=') ? [arg.slice(3)] : [])))

  if (name === 'git') {
    const git = gitCommand(args)

    if (GIT_WRITES.has(git.name)) files.push(...operands(git.args))

    if (git.name === 'apply' || git.name === 'am') files.push(...matches(command.input, DIFF_FILES))
  }

  if (name === 'patch') files.push(...matches(command.input, DIFF_FILES))

  if (INTERPRETERS.has(name)) {
    const scripts = [
      command.input,
      ...args.flatMap((arg, index) => (/^(?:-[ecp]|--eval|--print)$/.test(arg) ? [args[index + 1] ?? ''] : []))
    ]

    for (const script of scripts) if (SCRIPT_WRITES.test(script)) files.push(...namedIn(script))
  }

  return files
}

const absolute = (from: string, file: string): string => {
  const name = slashes(file)

  return isAbsolute(name) ? name : resolve(from, name)
}

/**
 * The folder a `cd` or `pushd` moves to, or undefined when the guard cannot tell, as for `cd`
 * alone, `cd -`, `cd ~` or a folder named by a variable: the commands after it keep the folder
 * before it.
 */
const changedDirectory = (from: string, command: ShellCommand): string | undefined => {
  const { name, args } = programOf(command.words)

  if (name !== 'cd' && name !== 'pushd') return undefined

  const [target] = operands(args)

  return target === undefined || /^[~$]/.test(target) || target.includes('$') ? undefined : resolve(from, target)
}

/**
 * The files the commands write, each resolved from every folder a `cd` before it could have left the
 * shell in. The guard does not follow subshells, so `(cd src) && ...` may or may not have moved; it
 * checks the write from each folder, which can only ask more, never less.
 */
const commandWrites = (top: string, base: string, commands: readonly ShellCommand[]): string[] => {
  const files: string[] = []
  const folders = new Set([base])
  let cwd = base

  for (const command of commands) {
    for (const folder of folders) {
      files.push(...writtenBy(command).map(file => absolute(folder, file)))
      files.push(...gitPathspecs(command).flatMap(pathspec => coveredBy(top, folder, pathspec)))
    }

    const next = changedDirectory(cwd, command)

    if (next !== undefined) {
      cwd = next
      folders.add(next)
    }
  }

  return files
}

/** What a tool call would change that the guard hands to a person, or undefined for anything else. */
export const guardFinding = (root: string, payload: GuardPayload): GuardFinding | undefined => {
  const top = repositoryRoot(root)
  const base = payload.cwd ?? root
  const commands = payload.command === undefined ? [] : shellCommands(payload.command)
  const named = [
    ...payload.files.map(file => absolute(base, file)),
    ...commandWrites(top, base, commands),
    ...matches(payload.command ?? '', PATCH_FILES).map(file => absolute(base, file))
  ]
  const files = named.flatMap(name => {
    const path = projectPath(top, name)

    if (path === undefined) return []

    // Removing or replacing the baseline's folder changes the baseline in it.
    const changed = posix.basename(path) === BASELINE_FOLDER ? posix.join(path, posix.basename(BASELINE_FILE)) : path

    return guarded(changed) ? [changed] : []
  })
  const records = commands.some(recordsBaseline)

  if (files.length === 0 && !records) return undefined

  return { files: [...new Set(files)], baseline: records || files.some(isBaseline), records }
}

const what = (finding: GuardFinding): string => {
  const parts = [
    ...(finding.records ? ['"pawl baseline", which records every current finding as allowed'] : []),
    ...finding.files.map(file => (isBaseline(file) ? `${file}, the findings the check allows` : file))
  ]

  return parts.join(' and ')
}

/**
 * The hook's answer, as the host reads it, or undefined to let the call through unchanged: Claude
 * Code and Copilot ask the person; Codex refuses a change to the baseline and lets the rest pass.
 */
export const guardReply = (payload: GuardPayload, finding: GuardFinding | undefined): string | undefined => {
  if (!finding) return undefined

  if (payload.host === 'codex') {
    if (!finding.baseline) return undefined

    const reason = `Pawl does not let a coding agent change what its check allows: this would change ${what(finding)}. Fix the findings instead. If the user wants to accept them, they run "pawl baseline" themselves.`

    return JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason }
    })
  }

  const reason = `This changes what pawl's check allows: ${what(finding)}. Allow it only if you asked for this change; otherwise the agent should fix the findings instead.`

  if (payload.host === 'copilot') return JSON.stringify({ permissionDecision: 'ask', permissionDecisionReason: reason })

  return JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: reason }
  })
}
