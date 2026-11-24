import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runEslint } from '../src/engines/eslint/run.ts'
import { project } from './helpers.ts'

const fixture = (report: unknown, code: number): string =>
  project({
    'package.json': { name: 'bad-eslint-report', type: 'module' },
    '.pawl/eslint-cache.json': { version: 1, deterministic: true, inputs: [] },
    'node_modules/eslint/package.json': {
      name: 'eslint',
      version: '10.15.0',
      type: 'module',
      bin: { eslint: './cli.js' }
    },
    'node_modules/eslint/cli.js': `import { writeFileSync } from 'node:fs'
const index = process.argv.indexOf('--cache-location')
if (index >= 0) writeFileSync(process.argv[index + 1], '[]')
process.stdout.write(JSON.stringify(${JSON.stringify(report)}))
process.exitCode = ${code}
`
  })

describe('ESLint report integrity before cache promotion', () => {
  it.each([
    { report: [], code: 1 },
    { report: [{ filePath: '/fixture.js', messages: [{}] }], code: 0 },
    {
      report: [{ filePath: '/fixture.js', messages: [{ ruleId: 'no-debugger', severity: 2, message: 'debugger' }] }],
      code: 0
    },
    { report: [{ filePath: '/fixture.js', messages: [], errorCount: 1 }], code: 1 },
    {
      report: [{ filePath: '/fixture.js', messages: [{ ruleId: 'rule', severity: 1, message: 'warn', line: -1 }] }],
      code: 0
    }
  ])('rejects malformed or inconsistent report $code / $report without promoting it', async ({ report, code }) => {
    const root = fixture(report, code)
    await expect(runEslint({ root, eslintCache: true })).rejects.toThrow(/report|diagnostics/i)
    expect(existsSync(join(root, '.pawl/cache/eslint/cache.json'))).toBe(false)
  })
})
