import { readFileSync } from 'node:fs'
import { writeText } from './fs.ts'

/** Any JSON value, for config files pawl writes in full. */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

export type JsonObject = { [key: string]: Json }

/** A parsed JSON object whose values are not known yet. */
export type JsonRecord = Record<string, unknown>

/** True for a plain object: not null and not an array. */
export const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** True when two values serialize the same. Key order counts, as it does in a file. */
export const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

/** The record with its keys sorted, so generated files do not churn. */
export const sortKeys = <T>(record: Readonly<Record<string, T>>): Record<string, T> =>
  Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)))

/** Merge `patch` into `target`, keeping every key `patch` does not mention. */
export const mergeDeep = (target: JsonRecord, patch: JsonRecord): JsonRecord => {
  const out: JsonRecord = { ...target }

  for (const [key, value] of Object.entries(patch)) {
    const current = out[key]

    out[key] = isRecord(current) && isRecord(value) ? mergeDeep(current, value) : value
  }

  return out
}

export const readJson = <T>(file: string): T | undefined => {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch {
    return undefined
  }
}

/** Parse JSON that may hold comments or trailing commas, as editor settings files often do. */
export const readJsonc = <T>(file: string): { value: T | undefined; hasComments: boolean } => {
  let text: string

  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return { value: undefined, hasComments: false }
  }

  const stripped = stripJsonComments(text)

  try {
    return { value: JSON.parse(stripTrailingCommas(stripped)) as T, hasComments: stripped !== text }
  } catch {
    return { value: undefined, hasComments: stripped !== text }
  }
}

const CLOSING = /\s*[}\]]/y

/** Drop the comma before a closing bracket, which JSON does not allow. A comma inside a string stays. */
const stripTrailingCommas = (text: string): string => {
  let out = ''
  let inString = false

  for (let index = 0; index < text.length; index++) {
    const char = text[index] as string

    if (inString) {
      out += char

      if (char === '\\') out += text[++index] ?? ''
      else if (char === '"') inString = false
    } else if (char === '"') {
      inString = true
      out += char
    } else if (char === ',') {
      CLOSING.lastIndex = index + 1

      if (!CLOSING.test(text)) out += char
    } else {
      out += char
    }
  }

  return out
}

const stripJsonComments = (text: string): string => {
  let out = ''
  let inString = false

  for (let index = 0; index < text.length; index++) {
    const char = text[index] as string
    const next = text[index + 1]

    if (inString) {
      out += char

      if (char === '\\') out += text[++index] ?? ''
      else if (char === '"') inString = false
    } else if (char === '"') {
      inString = true
      out += char
    } else if (char === '/' && next === '/') {
      while (index < text.length && text[index] !== '\n') index++

      out += '\n'
    } else if (char === '/' && next === '*') {
      index = text.indexOf('*/', index + 2)

      if (index === -1) break

      index++
    } else {
      out += char
    }
  }

  return out
}

export const writeJson = (file: string, value: unknown): void => writeText(file, `${JSON.stringify(value, null, 2)}\n`)
