import { describe, expect, it } from 'vitest'
import { BASELINE_FILE } from '../src/check/baseline.ts'
import { check } from '../src/check/check.ts'
import { formatAgent } from '../src/check/output.ts'
import { link, project } from './helpers.ts'

describe('the fix of a weaker test, with the real Biome', { timeout: 60_000 }, () => {
  it('matches what the test file lost or gained', async () => {
    const root = project({
      'package.json': { name: 'fixture', private: true, type: 'module' },
      'biome.json': { extends: ['@santi020k/pawl/biome'] },
      'src/a.test.js': `import { expect, it } from 'vitest'

it('waits', async () => {
  await sleep(500)
  expect(1).toBe(1)
}, 30000)

it('retries', { retry: 2 }, () => {
  expect(2).toBe(2)
})

it.skip('later', () => {})
`,
      [BASELINE_FILE]: {
        version: 1,
        findings: {},
        suppressions: {},
        tests: { 'src/a.test.js': { assertions: 3, skipped: 0, masks: 0 } }
      }
    })

    link(root)

    const lines = formatAgent(await check({ root }))
      .split('\n')
      .map(line => JSON.parse(line) as { line: number; rule: string; message: string; fix?: string })
      .filter(line => line.rule === 'pawl/no-weaker-tests')
      .map(({ line, message, fix }) => ({ line, fix, said: fix !== undefined && message.includes(fix) }))

    expect(lines.sort((a, b) => a.line - b.line)).toEqual([
      { line: 1, fix: 'Put back the checks the tests made, with the values they pinned.', said: true },
      {
        line: 4,
        fix: 'Wait for what the test needs with an assertion that retries, instead of for a fixed time.',
        said: true
      },
      {
        line: 6,
        fix: 'Find what the test waits for, and wait for that with an assertion that retries instead of giving it more time.',
        said: true
      },
      { line: 8, fix: 'Find why the test fails now and then, and fix that instead of running it again.', said: true },
      { line: 12, fix: 'Make the test pass instead of skipping it.', said: true }
    ])
  })
})
