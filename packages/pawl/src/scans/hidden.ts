import { readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { toPosix } from '../utils/fs.ts'
import { type OwnRule, ownRule as rule, type Scan } from './scan.ts'

/**
 * Characters that do not show on screen. A rules file or a skill can hide instructions in them
 * that an agent reads and follows and a reviewer never sees, the "Rules File Backdoor". In code
 * they flip what a line looks like against what it does, as in "Trojan Source".
 */
export const HIDDEN_RULES: readonly OwnRule[] = [
  rule(
    'no-hidden-characters',
    'error',
    'A character that does not show on screen is in the text.',
    'Delete it: hidden characters can carry instructions an agent follows and a reviewer cannot see. Where a file needs them, such as a translation, turn the rule off for that file in an override.'
  )
]

/** The folders AI coding tools keep their rules, skills, hooks and settings in. */
const AGENT_FOLDERS =
  /^(?:\.agents?|\.aider[^/]*|\.claude|\.clinerules|\.codex|\.copilot|\.cursor|\.gemini|\.kiro|\.opencode|\.roo|\.windsurf)\//

/** Copilot's instructions, prompts, agents, hooks and skills, which live under .github. */
const COPILOT_FILES = /^\.github\/(?:copilot-instructions\.md$|(?:instructions|prompts|agents|hooks|skills)\/)/

/** The instruction files agents read, wherever they are, and the files that wire up MCP servers. */
const AGENT_FILE_NAMES =
  /(?:^|\/)(?:AGENTS\.md|CLAUDE\.md|GEMINI\.md|SKILL\.md|\.cursorrules|\.windsurfrules|\.clinerules|\.mcp\.json|mcp\.json|replit\.md|\.aider[^/]*)$/

/** The agent folders at the root, by name, for the walk outside a git repository. */
const AGENT_FOLDER_NAME =
  /^(?:\.agents?|\.aider[^/]*|\.claude|\.clinerules|\.codex|\.copilot|\.cursor|\.gemini|\.kiro|\.opencode|\.roo|\.windsurf)$/

/**
 * Every file in the agent folders at the root. Git lists them in a repository, but the directory
 * walk pawl does outside one skips these folders, as the default ignores do.
 */
const agentFolderFiles = (root: string): string[] => {
  let entries: string[]

  try {
    entries = readdirSync(root).filter(name => AGENT_FOLDER_NAME.test(name))
  } catch {
    return []
  }

  return entries.flatMap(folder => {
    try {
      return readdirSync(join(root, folder), { recursive: true, withFileTypes: true })
        .filter(entry => entry.isFile())
        .map(entry => toPosix(relative(root, join(entry.parentPath, entry.name))))
        .filter(file => !file.split('/').includes('node_modules'))
    } catch {
      // A file such as .clinerules, or a folder that cannot be read.
      return []
    }
  })
}

/** True for a file that tells an agent what to do: its rules, skills, hooks and settings. */
export const isAgentFile = (file: string): boolean =>
  AGENT_FOLDERS.test(file) || COPILOT_FILES.test(file) || AGENT_FILE_NAMES.test(file)

/** The other files people review as text: code, the files the engines read, and docs. */
const TEXT_FILE =
  /\.(?:[cm]?[jt]sx?|vue|svelte|astro|jsonc?|ya?ml|toml|graphql|gql|css|scss|less|html|mdx?|markdown|mdc|txt)$/i

/** The characters that show as nothing, by name. A no-break space and the like show as space, so they are not here. */
const NAMES: ReadonlyMap<number, string> = new Map([
  [0x061c, 'ARABIC LETTER MARK'],
  [0x115f, 'HANGUL CHOSEONG FILLER'],
  [0x1160, 'HANGUL JUNGSEONG FILLER'],
  [0x180e, 'MONGOLIAN VOWEL SEPARATOR'],
  [0x200b, 'ZERO WIDTH SPACE'],
  [0x200c, 'ZERO WIDTH NON-JOINER'],
  [0x200d, 'ZERO WIDTH JOINER'],
  [0x200e, 'LEFT-TO-RIGHT MARK'],
  [0x200f, 'RIGHT-TO-LEFT MARK'],
  [0x202a, 'LEFT-TO-RIGHT EMBEDDING'],
  [0x202b, 'RIGHT-TO-LEFT EMBEDDING'],
  [0x202c, 'POP DIRECTIONAL FORMATTING'],
  [0x202d, 'LEFT-TO-RIGHT OVERRIDE'],
  [0x202e, 'RIGHT-TO-LEFT OVERRIDE'],
  [0x2060, 'WORD JOINER'],
  [0x2061, 'FUNCTION APPLICATION'],
  [0x2062, 'INVISIBLE TIMES'],
  [0x2063, 'INVISIBLE SEPARATOR'],
  [0x2064, 'INVISIBLE PLUS'],
  [0x2066, 'LEFT-TO-RIGHT ISOLATE'],
  [0x2067, 'RIGHT-TO-LEFT ISOLATE'],
  [0x2068, 'FIRST STRONG ISOLATE'],
  [0x2069, 'POP DIRECTIONAL ISOLATE'],
  [0x3164, 'HANGUL FILLER'],
  [0xfeff, 'ZERO WIDTH NO-BREAK SPACE'],
  [0xffa0, 'HALFWIDTH HANGUL FILLER'],
  [0xfff9, 'INTERLINEAR ANNOTATION ANCHOR'],
  [0xfffa, 'INTERLINEAR ANNOTATION SEPARATOR'],
  [0xfffb, 'INTERLINEAR ANNOTATION TERMINATOR']
])

/**
 * Joiners, marks and fillers that languages written in other scripts use: Persian and the Indic
 * scripts join and break letters with them, Hebrew and Arabic text sets its direction, Thai
 * breaks words, Korean fills syllables. Next to a letter of such a script they are text.
 */
const SCRIPT_MARKS = new Set([0x061c, 0x115f, 0x1160, 0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x3164, 0xffa0])

const isTag = (code: number): boolean => code >= 0xe0000 && code <= 0xe007f

const isSelector = (code: number): boolean => (code >= 0xfe00 && code <= 0xfe0f) || (code >= 0xe0100 && code <= 0xe01ef)

const BLACK_FLAG = 0x1f3f4

// Unicode RGI tag flags: England, Scotland and Wales.
const TAG_FLAG =
  /^\u{1F3F4}\u{E0067}\u{E0062}(?:\u{E0065}\u{E006E}\u{E0067}|\u{E0073}\u{E0063}\u{E0074}|\u{E0077}\u{E006C}\u{E0073})\u{E007F}$/u

const CANCEL_TAG = 0xe007f

const FOREIGN_LETTER = /[\p{L}\p{M}]/u

const LATIN = /\p{Script=Latin}/u

const PICTOGRAPH = /\p{Extended_Pictographic}/u

const HAN = /\p{Script=Han}/u

/** A letter or mark of a script other than Latin. */
const foreign = (char: string | undefined): boolean =>
  char !== undefined && FOREIGN_LETTER.test(char) && !LATIN.test(char)

/** An emoji, or what continues one: a skin tone or the selector that asks for emoji style. */
const emojiPart = (char: string | undefined): boolean => {
  if (char === undefined) return false

  const code = char.codePointAt(0) ?? 0

  return PICTOGRAPH.test(char) || (code >= 0x1f3fb && code <= 0x1f3ff) || code === 0xfe0f
}

/** The text a run of tag characters spells: each one is an ASCII character moved up to U+E0000. */
const spelled = (codes: readonly number[]): string =>
  codes
    .filter(code => isTag(code) && code !== CANCEL_TAG)
    .map(code => String.fromCodePoint(code - 0xe0000))
    .join('')

const hex = (code: number): string => `U+${code.toString(16).toUpperCase().padStart(4, '0')}`

const describe = (code: number): string => {
  if (isTag(code)) return `${hex(code)} TAG CHARACTER`

  if (isSelector(code)) return `${hex(code)} VARIATION SELECTOR`

  return `${hex(code)} ${NAMES.get(code) ?? 'INVISIBLE CHARACTER'}`
}

/** What a line hides: where the first hidden character is, and each one, as code points. */
export interface Hidden {
  column: number
  codes: number[]
}

/**
 * The hidden characters on one line, with what is fine taken out: the joiners and selectors in
 * emoji, a flag's tag sequence, one variation selector after a character, the marks other scripts
 * use next to their letters, and a byte order mark that starts the file.
 */
export const findHidden = (line: string, firstLine = false): Hidden | undefined => {
  const chars = [...line]
  const codes: number[] = []
  let column = 0
  let offset = 0
  let flagEnd = -1

  for (const [index, char] of chars.entries()) {
    const code = char.codePointAt(0) ?? 0
    const before = chars[index - 1]
    const after = chars[index + 1]
    const previous = before?.codePointAt(0) ?? -1
    const at = offset

    offset += char.length

    // Only complete Unicode flag sequences may hide tags; an arbitrary payload is not a flag.
    if (code === BLACK_FLAG && TAG_FLAG.test(chars.slice(index, index + 7).join(''))) {
      flagEnd = index + 6
    }

    if (isTag(code) && index <= flagEnd) continue

    const hidden =
      isTag(code) ||
      (isSelector(code) && (isSelector(previous) || before === undefined || (code >= 0xe0100 && !HAN.test(before)))) ||
      (NAMES.has(code) &&
        !(code === 0xfeff && firstLine && index === 0) &&
        !(code === 0x200d && emojiPart(before) && PICTOGRAPH.test(after ?? '')) &&
        !(SCRIPT_MARKS.has(code) && (foreign(before) || foreign(after))))

    if (!hidden) continue

    if (codes.length === 0) column = at + 1

    codes.push(code)
  }

  return codes.length > 0 ? { column, codes } : undefined
}

/** What a finding says the line hides: each kind of character once, and the text tag characters spell. */
export const hiddenDetail = (codes: readonly number[]): string => {
  const counts = new Map<string, number>()

  for (const code of codes) counts.set(describe(code), (counts.get(describe(code)) ?? 0) + 1)

  const kinds = [...counts].map(([name, count]) => (count > 1 ? `${name} x${count}` : name))
  const text = spelled(codes)
  const shown = text.length > 60 ? `${text.slice(0, 60)}...` : text

  return [...kinds.slice(0, 3), ...(kinds.length > 3 ? [`and ${kinds.length - 3} more kinds`] : [])]
    .join(', ')
    .concat(shown.trim() ? `; they spell "${shown}"` : '')
}

/** A file that holds a NUL is binary, such as an image a skill ships with. */
const isBinary = (text: string): boolean => text.includes('\u0000')

export const hiddenScan: Scan = {
  reads: 'agent instructions, skills and settings, code, and docs',
  rules: HIDDEN_RULES,
  matches: file => isAgentFile(file) || TEXT_FILE.test(file),
  // The default ignores skip the folders AI tools keep, which is where a poisoned rules file goes.
  readsIgnored: isAgentFile,
  alsoLists: agentFolderFiles,
  scan: (_file, text, report) => {
    if (isBinary(text)) return

    text.split(/\r?\n/).forEach((line, index) => {
      const hidden = findHidden(line, index === 0)

      if (hidden) report('no-hidden-characters', index + 1, hidden.column, hiddenDetail(hidden.codes))
    })
  }
}
