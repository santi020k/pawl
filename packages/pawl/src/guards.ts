import { type Level, type Policy } from './types.ts'

/** A module that should not be imported, or names that should not be imported from it. */
export interface RestrictedPath {
  name: string
  importNames?: string[]
  message: string
}

/** Import paths that should not be used, as gitignore-style patterns. */
export interface RestrictedPattern {
  group: string[]
  message: string
}

/** The same piece of code as a GritQL pattern, which is how Biome runs a rule of pawl's own. */
export interface GritPattern {
  pattern: string
  /** Extra conditions on the pattern's variables. */
  conditions?: string[]
  /** The variable the finding points at. The whole match when left out. */
  span?: string
}

/** A piece of code that should not be written: an ESLint selector, and the same thing for Biome. */
export interface RestrictedSyntax {
  selector: string
  message: string
  /** Left out when another entry of the guard already covers this code in Biome. */
  grit?: GritPattern
}

/**
 * Checks for one library that need no plugin: imports and code patterns to stay away from.
 *
 * A guard is data only, like a pack. It switches on when the project depends on the library.
 * Import restrictions are enforced by whichever linter the project uses. Code patterns need ESLint.
 */
export interface Guard {
  name: string
  title: string
  /** Dependencies that switch the guard on. A trailing `/*` matches every package in a scope. */
  when: string[]
  /** On only when the policy names it under `packs`, as an optional pack would be. */
  optIn?: boolean
  /** The level its code patterns run at. `error` when left out. */
  level?: Level
  paths?: RestrictedPath[]
  patterns?: RestrictedPattern[]
  syntax?: RestrictedSyntax[]
}

/** The internals of a package: its build output and its source. */
const internals = (...packages: string[]): string[] =>
  packages.flatMap(name => [`${name}/dist/*`, `${name}/dist/**`, `${name}/src/*`, `${name}/src/**`])

const KEY_NAMES = 'apiKey|api_key|openAIApiKey|anthropicApiKey|googleApiKey|authToken|accessToken'

const KEY_OPTION = `/^(${KEY_NAMES})$/`

/** A quote character, for patterns that match a string literal by its source text. */
const QUOTE = `['"\`]`

/** The code patterns again, as GritQL. Biome matches source text, so literals are matched with their quotes. */
const GRIT = {
  apiKey: {
    pattern: '`$key: $value`',
    conditions: [
      `$key <: r"^(?:${KEY_NAMES})$"`,
      `$value <: r"^${QUOTE.replace('"', '\\"')}[^$]{8,}${QUOTE.replace('"', '\\"')}$"`
    ],
    span: '$value'
  },
  allowBrowser: { pattern: '`dangerouslyAllowBrowser: true`' },
  wildcardCors: {
    pattern: '`$context.header($name, $value)`',
    conditions: [`$name <: r"^['\\"]Access-Control-Allow-Origin['\\"]$"`, `$value <: r"^['\\"]\\*['\\"]$"`]
  },
  negatedAnd: { pattern: '`!($a && $b)`' },
  negatedOr: { pattern: '`!($a || $b)`' }
} satisfies Record<string, GritPattern>

export const GUARDS: readonly Guard[] = [
  {
    name: 'ai-keys',
    title: 'AI client keys',
    when: [
      'openai',
      '@openai/agents',
      '@anthropic-ai/sdk',
      '@google/genai',
      '@google/generative-ai',
      'ai',
      '@ai-sdk/*',
      'langchain',
      '@langchain/*',
      'llamaindex',
      '@llamaindex/*',
      '@mastra/*',
      '@modelcontextprotocol/sdk'
    ],
    syntax: [
      {
        selector: `Property[key.name=${KEY_OPTION}] > Literal.value[value=/^.{8,}$/]`,
        message: 'Do not write an API key in the code. Read it from the environment or a secret store.',
        grit: GRIT.apiKey
      },
      {
        selector: `Property[key.name=${KEY_OPTION}] > TemplateLiteral.value[expressions.length=0]`,
        message: 'Do not write an API key in the code. Read it from the environment or a secret store.'
      },
      {
        selector: "Property[key.name='dangerouslyAllowBrowser'][value.value=true]",
        message: 'dangerouslyAllowBrowser sends your API key to every visitor. Call the model from a server.',
        grit: GRIT.allowBrowser
      }
    ]
  },
  {
    name: 'ai-sdk',
    title: 'AI SDK',
    when: ['ai', '@ai-sdk/*'],
    patterns: [
      {
        group: internals('ai', '@ai-sdk/*'),
        message: 'Import AI SDK APIs from "ai" or a documented "@ai-sdk/..." entry point, not from package internals.'
      }
    ]
  },
  {
    name: 'langchain',
    title: 'LangChain',
    when: ['langchain', '@langchain/*'],
    patterns: [
      {
        group: internals('langchain', '@langchain/*'),
        message:
          'Import LangChain APIs from documented entry points such as "@langchain/core/messages", not from package internals.'
      }
    ]
  },
  {
    name: 'llamaindex',
    title: 'LlamaIndex',
    when: ['llamaindex', '@llamaindex/*'],
    patterns: [
      {
        group: internals('llamaindex', '@llamaindex/*'),
        message:
          'Import LlamaIndex APIs from documented entry points such as "llamaindex" or "@llamaindex/core", not from package internals.'
      }
    ]
  },
  {
    name: 'mastra',
    title: 'Mastra',
    when: ['mastra', '@mastra/*'],
    patterns: [
      {
        group: internals('@mastra/*'),
        message: 'Import Mastra APIs from documented entry points, not from package internals.'
      }
    ]
  },
  {
    name: 'mcp',
    title: 'Model Context Protocol SDK',
    when: ['@modelcontextprotocol/sdk'],
    patterns: [
      {
        group: [
          '@modelcontextprotocol/sdk/dist/*',
          '@modelcontextprotocol/sdk/dist/**',
          '@modelcontextprotocol/sdk/shared/*',
          '@modelcontextprotocol/sdk/shared/**'
        ],
        message:
          'Import MCP SDK APIs from the documented server, client or types entry points, not from internal modules.'
      }
    ]
  },
  {
    name: 'openai-agents',
    title: 'OpenAI Agents SDK',
    when: ['@openai/agents'],
    paths: [
      {
        name: 'openai/agents',
        message: 'Use the "@openai/agents" SDK for agent workflows, not agents from the base OpenAI client.'
      }
    ],
    patterns: [
      {
        group: internals('@openai/agents'),
        message: 'Import OpenAI Agents SDK APIs from "@openai/agents" or a documented subpath, not from internals.'
      }
    ]
  },
  {
    name: 'openai',
    title: 'OpenAI SDK',
    when: ['openai'],
    patterns: [
      {
        group: [
          'openai/dist/*',
          'openai/dist/**',
          'openai/src/*',
          'openai/src/**',
          'openai/_shims/*',
          'openai/internal/*'
        ],
        message: 'Import OpenAI SDK APIs from "openai" or a documented subpath, not from internals.'
      }
    ]
  },
  {
    name: 'anthropic',
    title: 'Anthropic SDK',
    when: ['@anthropic-ai/sdk'],
    patterns: [
      {
        group: [...internals('@anthropic-ai/sdk'), '@anthropic-ai/sdk/_shims/*', '@anthropic-ai/sdk/internal/*'],
        message: 'Import Anthropic SDK APIs from "@anthropic-ai/sdk" or a documented subpath, not from internals.'
      }
    ]
  },
  {
    name: 'autogen',
    title: 'AutoGen',
    when: ['autogen-agentchat', 'autogen-core'],
    patterns: [
      {
        group: ['autogen-agentchat/dist/*', 'autogen-core/dist/*'],
        message: 'Import AutoGen APIs from their package entry points, not from internals.'
      }
    ]
  },
  {
    name: 'google-genai',
    title: 'Google GenAI SDK',
    when: ['@google/genai', '@google/generative-ai'],
    paths: [
      {
        name: '@google/generative-ai',
        message: 'Use the "@google/genai" SDK. "@google/generative-ai" is the legacy one.'
      }
    ],
    patterns: [
      {
        group: ['@google/genai/dist/*', '@google/genai/src/*'],
        message: 'Import Google GenAI SDK APIs from "@google/genai", not from internals.'
      }
    ]
  },
  {
    name: 'hono',
    title: 'Hono',
    when: ['hono'],
    patterns: [
      {
        group: internals('hono', '@hono/*'),
        message: 'Import Hono APIs from documented entry points such as "hono/cors", not from package internals.'
      }
    ],
    syntax: [
      {
        selector:
          "CallExpression[callee.property.name='header'][arguments.0.value='Access-Control-Allow-Origin'][arguments.1.value='*']",
        message:
          'Use the cors() middleware from "hono/cors" with an explicit origin, not a hand-written wildcard header.',
        grit: GRIT.wildcardCors
      }
    ]
  },
  {
    // Was the eslint-plugin-de-morgan pack. Two rules, small enough to be pawl's own.
    name: 'de-morgan',
    title: 'De Morgan',
    when: [],
    optIn: true,
    level: 'warn',
    syntax: [
      {
        selector: "UnaryExpression[operator='!'] > LogicalExpression[operator='&&']",
        message: 'A negated AND is hard to read. Write !a || !b.',
        grit: GRIT.negatedAnd
      },
      {
        selector: "UnaryExpression[operator='!'] > LogicalExpression[operator='||']",
        message: 'A negated OR is hard to read. Write !a && !b.',
        grit: GRIT.negatedOr
      }
    ]
  }
]

const BY_NAME = new Map(GUARDS.map(guard => [guard.name, guard]))

export const getGuard = (name: string): Guard | undefined => BY_NAME.get(name)

const matches = (trigger: string, dependencies: readonly string[]): boolean =>
  trigger.endsWith('/*')
    ? dependencies.some(name => name.startsWith(trigger.slice(0, -1)))
    : dependencies.includes(trigger)

/** The guards for what a project depends on, plus the opt-in ones its policy names under `packs`. */
export const activeGuards = (dependencies: readonly string[] = [], packs: readonly string[] = []): Guard[] =>
  GUARDS.filter(guard =>
    guard.optIn ? packs.includes(guard.name) : guard.when.some(trigger => matches(trigger, dependencies))
  )

/** The level a guard's code patterns run at: the policy's `pawl/<guard>`, else the guard's own. */
export const guardLevel = (policy: Policy, guard: Guard): Level =>
  policy.rules[`pawl/${guard.name}`] ?? guard.level ?? 'error'

export const IMPORTS_RULE = 'no-restricted-imports'

export const SYNTAX_RULE = 'no-restricted-syntax'

type Options = Record<string, unknown>

const isRecord = (value: unknown): value is Options =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

/** The level a guard rule runs at: the policy's, else `error` when there is something to enforce. */
const levelOf = (policy: Policy, rule: string, hasWork: boolean): Level =>
  policy.rules[rule] ?? (hasWork ? 'error' : 'off')

export interface ImportRestrictions {
  level: Level
  /** In ESLint's shape, which Oxlint shares. */
  eslint: { paths: unknown[]; patterns: unknown[] }
  /** In Biome's shape. */
  biome: { paths: Record<string, unknown>; patterns: unknown[] }
}

/**
 * The import restrictions for a project: the guards for its dependencies, plus the policy's own
 * `no-restricted-imports` options. Undefined when there is nothing to restrict.
 */
export const importRestrictions = (
  policy: Policy,
  dependencies: readonly string[] = []
): ImportRestrictions | undefined => {
  const guards = activeGuards(dependencies, policy.packs)
  // The policy's own options come first, in the shape ESLint takes: a list of paths, or an object.
  const given = policy.options[IMPORTS_RULE] ?? []
  const own = isRecord(given[0]) && ('paths' in given[0] || 'patterns' in given[0]) ? given[0] : { paths: given }
  const paths = [...list(own.paths), ...guards.flatMap(guard => guard.paths ?? [])]
  const patterns = [...list(own.patterns), ...guards.flatMap(guard => guard.patterns ?? [])]
  const level = levelOf(policy, IMPORTS_RULE, paths.length + patterns.length > 0)

  if (level === 'off' || paths.length + patterns.length === 0) return undefined

  const biomePaths: Record<string, unknown> = {}

  for (const path of paths) {
    if (typeof path === 'string') biomePaths[path] = `Do not import "${path}".`
    else if (isRecord(path) && typeof path.name === 'string') {
      const { name, ...rest } = path

      biomePaths[name] = {
        message: typeof rest.message === 'string' ? rest.message : `Do not import "${name}".`,
        ...(Array.isArray(rest.importNames) ? { importNames: rest.importNames } : {})
      }
    }
  }

  // Biome takes patterns as a group of globs with a message. Other shapes stay with ESLint.
  const biomePatterns = patterns.flatMap(pattern =>
    isRecord(pattern) && Array.isArray(pattern.group)
      ? [{ group: pattern.group, ...(typeof pattern.message === 'string' ? { message: pattern.message } : {}) }]
      : []
  )

  return { level, eslint: { paths, patterns }, biome: { paths: biomePaths, patterns: biomePatterns } }
}

/** The guards whose code patterns are on, with the level each runs at. */
const patternGuards = (policy: Policy, dependencies: readonly string[]): Array<{ guard: Guard; level: Level }> =>
  policy.rules[SYNTAX_RULE] === 'off'
    ? []
    : activeGuards(dependencies, policy.packs).flatMap(guard => {
        const level = guardLevel(policy, guard)

        return guard.syntax && level !== 'off' ? [{ guard, level }] : []
      })

/**
 * The code patterns to refuse, for ESLint: the guards', after the policy's own `no-restricted-syntax`
 * options. ESLint gives one rule one level, so the strictest of the guards speaks for all of them.
 */
export const syntaxRestrictions = (
  policy: Policy,
  dependencies: readonly string[] = []
): { level: Level; options: unknown[] } | undefined => {
  const guards = patternGuards(policy, dependencies)
  const own = policy.options[SYNTAX_RULE] ?? []
  const options = [
    ...own,
    ...guards.flatMap(({ guard }) => (guard.syntax ?? []).map(({ selector, message }) => ({ selector, message })))
  ]
  const strictest = own.length > 0 || guards.some(({ level }) => level === 'error') ? 'error' : 'warn'
  const level = policy.rules[SYNTAX_RULE] ?? strictest

  return level === 'off' || options.length === 0 ? undefined : { level, options }
}

/** Where pawl writes the rules of its own that Biome runs. */
export const RULES_DIR = '.pawl/rules'

export interface RuleFile {
  /** Relative to the folder of the Biome config that loads it. */
  file: string
  content: string
  guard: string
}

/** Biome shows a plugin's message as written, escapes and all, so the message goes in with single quotes only. */
const plain = (text: string): string => text.replaceAll('"', "'")

const quote = (text: string): string => `"${plain(text).replaceAll('\\', '\\\\')}"`

/**
 * The code patterns as Biome plugins: one GritQL file for each guard that is on.
 * Biome loads a plugin from a file, so `pawl init` and `pawl sync` write these into the project.
 */
export const ruleFiles = (policy: Policy, dependencies: readonly string[] = []): RuleFile[] =>
  patternGuards(policy, dependencies).flatMap(({ guard, level }) => {
    const clauses = (guard.syntax ?? []).flatMap(({ grit, message }) => {
      if (!grit) return []

      const lines = [
        ...(grit.conditions ?? []),
        `register_diagnostic(span = ${grit.span ?? '$match'}, message = ${quote(message)}, severity = "${level}")`
      ]

      return [`  ${grit.pattern} as $match where {\n    ${lines.join(',\n    ')}\n  }`]
    })

    if (clauses.length === 0) return []

    const content = [
      `// Written by pawl for the "${guard.name}" guard. Run "pawl sync" to update it; do not edit it.`,
      'engine biome(1.0)',
      'language js(typescript, jsx)',
      '',
      `or {\n${clauses.join(',\n')}\n}`,
      ''
    ].join('\n')

    return [{ file: `${RULES_DIR}/${guard.name}.grit`, content, guard: guard.name }]
  })

/** The guard a finding of one of pawl's own Biome rules came from, by its message. */
export const guardOfMessage = (message: string): string | undefined =>
  GUARDS.find(guard => (guard.syntax ?? []).some(entry => plain(entry.message) === plain(message)))?.name
