import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { planInit } from '../src/setup/init.ts'
import { applyPlan } from '../src/setup/plan.ts'
import { readJsonc } from '../src/utils/json.ts'
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
