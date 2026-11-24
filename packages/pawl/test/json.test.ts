import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { planInit } from '../src/setup/init.ts'
import { applyPlan } from '../src/setup/plan.ts'
import { mergeDeep, readJsonc } from '../src/utils/json.ts'
import { link, project } from './helpers.ts'

describe('JSON with comments', () => {
  const read = (text: string) => readJsonc<unknown>(join(project({ 'settings.json': text }), 'settings.json'))

  it('is read without its comments and trailing commas', () => {
    expect(read('{\n  // a note\n  "a": 1, /* and another */\n  "list": [1, 2,],\n}\n')).toEqual({
      value: { a: 1, list: [1, 2] },
      hasComments: true
    })
    expect(read('{ "list": [1, 2 , ] , }')).toEqual({ value: { list: [1, 2] }, hasComments: false })
  })

  it('keeps what a string holds, even when it looks like a comment or a trailing comma', () => {
    const value = {
      glob: '**/*.{js,}',
      pattern: '[,]]',
      url: 'https://example.com/a//b',
      note: 'a /* b */ c',
      quoted: 'say "x",]'
    }

    expect(read(JSON.stringify(value))).toEqual({ value, hasComments: false })
  })

  it('is undefined for a file that is not JSON, or not there', () => {
    expect(read('{ "a": ').value).toBeUndefined()
    expect(readJsonc(join(project(), 'missing.json'))).toEqual({ value: undefined, hasComments: false })
  })
})

describe('a settings file pawl merges into', () => {
  it('keeps the strings the project wrote in it', async () => {
    const settings = { 'files.exclude': { '**/*.{js,}': true }, 'search.exclude': { 'tmp/[,]]': true } }
    const root = project({
      'package.json': { name: 'fixture', private: true, type: 'module' },
      '.vscode/settings.json': settings
    })

    link(root)
    applyPlan(await planInit({ root, install: false }))

    expect(JSON.parse(readFileSync(join(root, '.vscode/settings.json'), 'utf8'))).toMatchObject(settings)
  })
})

describe('mergeDeep', () => {
  it('preserves own __proto__, constructor and prototype keys as JSON data without prototype pollution', () => {
    const descriptorsBefore = Object.getOwnPropertyDescriptors(Object.prototype)
    const target = JSON.parse('{"keep":1,"__proto__":{"existing":1,"nested":{"a":1}},"constructor":{"a":1}}') as Record<
      string,
      unknown
    >
    const patch = JSON.parse(
      '{"__proto__":{"added":2,"nested":{"b":2}},"constructor":{"b":2},"prototype":{"p":true}}'
    ) as Record<string, unknown>

    const merged = mergeDeep(target, patch)

    expect(Object.getOwnPropertyDescriptors(Object.prototype)).toEqual(descriptorsBefore)
    expect(Object.getPrototypeOf(merged)).toBe(Object.prototype)
    expect(Object.hasOwn(merged, '__proto__')).toBe(true)
    expect(Object.hasOwn(merged, 'constructor')).toBe(true)
    expect(Object.hasOwn(merged, 'prototype')).toBe(true)
    expect(Object.getOwnPropertyDescriptor(merged, '__proto__')?.value).toEqual({
      existing: 1,
      added: 2,
      nested: { a: 1, b: 2 }
    })
    expect(merged.constructor).toEqual({ a: 1, b: 2 })
    expect(merged.prototype).toEqual({ p: true })

    const serialized = JSON.stringify(merged)
    const roundTripped = JSON.parse(serialized) as Record<string, unknown>

    expect(Object.hasOwn(roundTripped, '__proto__')).toBe(true)
    expect(Object.getOwnPropertyDescriptor(roundTripped, '__proto__')?.value).toEqual({
      existing: 1,
      added: 2,
      nested: { a: 1, b: 2 }
    })
    expect(roundTripped).toEqual(
      JSON.parse(
        '{"keep":1,"__proto__":{"existing":1,"nested":{"a":1,"b":2},"added":2},"constructor":{"a":1,"b":2},"prototype":{"p":true}}'
      )
    )
    expect('added' in ({} as Record<string, unknown>)).toBe(false)
    expect('added' in merged).toBe(false)
  })

  it('ignores inherited keys on target and replaces arrays instead of merging them as objects', () => {
    const inheritedTarget = Object.create({ inheritedObj: { fromProto: true } }) as Record<string, unknown>

    inheritedTarget.rules = { a: ['off'], nested: { arr: [1, 2], objToArr: { x: 1 }, arrToObj: [1, 2] } }

    const merged = mergeDeep(inheritedTarget, {
      inheritedObj: { fromPatch: true },
      rules: { a: ['error', { allow: true }], nested: { arr: [3], objToArr: [9], arrToObj: { y: 2 } } }
    })

    expect(merged.inheritedObj).toEqual({ fromPatch: true })
    expect(merged.rules).toEqual({
      a: ['error', { allow: true }],
      nested: { arr: [3], objToArr: [9], arrToObj: { y: 2 } }
    })
  })
})
