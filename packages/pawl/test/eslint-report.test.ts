import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runEslint } from '../src/engines/eslint/run.ts'
import { link, project } from './helpers.ts'

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

describe('ESLint report positions', () => {
  it('reads a parse error at column 0, as the YAML and GraphQL parsers report one, with the other findings', async () => {
    // yaml-eslint-parser and @graphql-eslint's parser count columns from 0, and ESLint passes the
    // column of a parse error on as the parser gave it.
    const root = project({
      'package.json': { name: 'column-zero', type: 'module' },
      'parser.js': `export const parseForESLint = () => {
  throw Object.assign(new SyntaxError('Unexpected end of the flow sequence'), { lineNumber: 2, column: 0 })
}
`,
      'eslint.config.js': `import * as parser from './parser.js'
export default [
  { files: ['**/*.js'], rules: { 'no-debugger': 'error' } },
  { files: ['**/*.yaml'], languageOptions: { parser } }
]
`,
      'broken.yaml': 'list: [1, 2\nnext: 3\n',
      'src/a.js': 'debugger\n'
    })

    link(root, { eslint: true })

    const { findings } = await runEslint({ root, files: ['broken.yaml', 'src/a.js'] })

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ file: 'broken.yaml', line: 2, column: 1, rule: 'eslint:parse', severity: 'error' }),
        expect.objectContaining({ file: 'src/a.js', rule: 'no-debugger' })
      ])
    )
  })
})

describe('ESLint messages without a rule', () => {
  it('names an unused disable directive by what it is, not as a parse error', async () => {
    const root = project({
      'package.json': { name: 'directives', type: 'module' },
      'eslint.config.js': `export default [
  { files: ['**/*.js'], linterOptions: { reportUnusedDisableDirectives: 'warn' }, rules: { 'no-console': 'error' } }
]
`,
      'src/unused.js': '// eslint-disable-next-line no-console\nexport const value = 1\n',
      'src/broken.js': 'export const = 1\n'
    })

    link(root, { eslint: true })

    const { findings } = await runEslint({ root, files: ['src/unused.js', 'src/broken.js'] })

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: 'src/unused.js',
          line: 1,
          rule: 'eslint:unused-disable-directive',
          engineRule: 'unused-disable-directive',
          severity: 'warn',
          fixable: true
        }),
        expect.objectContaining({ file: 'src/broken.js', rule: 'eslint:parse', severity: 'error' })
      ])
    )
    expect(findings).toHaveLength(2)
  })
})
