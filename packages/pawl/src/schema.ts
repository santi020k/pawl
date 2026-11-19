import { DETECTABLE } from './detect.ts'
import { RUNTIMES } from './runtime.ts'
import { type PolicyInput } from './types.ts'

/** The part of JSON Schema the policy schema uses. */
export interface JsonSchema {
  $schema?: string
  $id?: string
  title?: string
  description?: string
  type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean'
  enum?: readonly (string | number | boolean)[]
  properties?: Record<string, JsonSchema>
  required?: readonly string[]
  additionalProperties?: boolean | JsonSchema
  items?: JsonSchema
  uniqueItems?: boolean
  minimum?: number
  anyOf?: readonly JsonSchema[]
  $ref?: string
  definitions?: Record<string, JsonSchema>
}

const LEVEL: JsonSchema = { type: 'string', enum: ['off', 'warn', 'error'] }

const strings = (description?: string): JsonSchema => ({
  type: 'array',
  items: { type: 'string' },
  ...(description ? { description } : {})
})

const rules: JsonSchema = {
  type: 'object',
  description: "Rule levels by ESLint's rule names. `biome:group/name` reaches a rule only Biome has.",
  additionalProperties: LEVEL
}

const options: JsonSchema = {
  type: 'object',
  description: "Rule options in ESLint's shape, by the same names as `rules`. ESLint and Oxlint take them.",
  additionalProperties: { type: 'array' }
}

const biomeOptions: JsonSchema = {
  type: 'object',
  description: "Rule options in Biome's shape, by the same names as `rules`. Only Biome takes them.",
  additionalProperties: { type: 'object' }
}

const runtime: JsonSchema = { type: 'string', enum: RUNTIMES }

/**
 * Every option of a policy. Typed by `PolicyInput`'s keys, so the schema cannot leave one out
 * or list one the type does not have.
 */
const PROPERTIES: Record<keyof PolicyInput, JsonSchema> = {
  $schema: { type: 'string', description: 'The JSON schema of this file, for editors. Pawl ignores it.' },
  extends: {
    description: 'Policies to build on: a package name, a path relative to this file, or a list of them.',
    anyOf: [{ type: 'string' }, { $ref: '#' }, { type: 'array', items: { anyOf: [{ type: 'string' }, { $ref: '#' }] } }]
  },
  engine: {
    type: 'string',
    enum: ['auto', 'biome', 'oxlint', 'eslint'],
    description: 'The linter. `auto` is Biome, with ESLint next to it when the repo has a flat config.'
  },
  formatter: {
    type: 'string',
    enum: ['auto', 'biome', 'prettier'],
    description: 'The formatter. `auto` is Biome, unless the linter is not Biome and the repo has a Prettier config.'
  },
  packs: strings('Optional packs to switch on. `unicorn/recommended` starts a pack from the plugin preset.'),
  strict: { type: 'boolean', description: 'Use the stricter level of every rule that has one.' },
  maxWarnings: {
    type: 'integer',
    minimum: 0,
    description: 'Fail the check when there are more new warnings than this. A later layer can only lower it.'
  },
  style: {
    type: 'object',
    additionalProperties: false,
    properties: {
      indent: { enum: [2, 4, 'tab'] },
      lineWidth: { type: 'integer', minimum: 1 },
      quotes: { type: 'string', enum: ['single', 'double'] },
      semicolons: { type: 'boolean' },
      trailingCommas: { type: 'string', enum: ['none', 'all'] },
      arrowParens: { type: 'string', enum: ['as-needed', 'always'] }
    }
  },
  rules,
  options,
  biomeOptions,
  overrides: {
    type: 'array',
    description: 'Rule levels and options for some files only. Later entries win.',
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['files'],
      properties: {
        files: strings('Glob patterns of the files. A pattern without a slash matches at any depth.'),
        rules,
        options,
        biomeOptions
      }
    }
  },
  locked: strings('Rules that later layers may tighten but never loosen.'),
  ignore: strings('Extra glob patterns to skip. A pattern without a slash matches at any depth.'),
  gitignore: { type: 'boolean', description: 'Skip what the root .gitignore lists. On by default.' },
  defaultIgnores: {
    type: 'boolean',
    description: 'Skip build output, caches, lockfiles, AI tool folders and generated code. On by default.'
  },
  runtime: {
    description: 'Where the code runs, instead of what pawl detects.',
    anyOf: [runtime, { type: 'array', items: runtime, uniqueItems: true }]
  },
  detect: {
    description: 'Work out the technologies from the dependencies and files. `false` turns it off.',
    anyOf: [
      { type: 'boolean' },
      {
        type: 'object',
        additionalProperties: false,
        properties: { exclude: { type: 'array', items: { type: 'string', enum: DETECTABLE }, uniqueItems: true } }
      }
    ]
  }
}

/** The keys a policy may have. */
export const POLICY_KEYS = Object.keys(PROPERTIES) as (keyof PolicyInput)[]

/** The JSON schema of `pawl.config.json` and of a policy package's default export. */
export const POLICY_SCHEMA: JsonSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://unpkg.com/@santi020k/pawl/pawl.config.schema.json',
  title: 'pawl policy',
  description: 'The policy of a repo: https://pawl.santi020k.com/reference/config/',
  type: 'object',
  additionalProperties: false,
  properties: PROPERTIES
}
