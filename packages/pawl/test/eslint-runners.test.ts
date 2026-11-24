import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'
import { eslintPlan, mergeLayers } from '../src/index.ts'
import { playwright, pluginRoot, vitest } from './fixtures/eslint/plugins.ts'
import { project } from './helpers.ts'

const prepare = async () => {
  const root = project({ 'package.json': { name: 'mixed-runners', type: 'module' } })
  const policy = mergeLayers([
    {
      source: 'repo',
      input: {
        packs: ['vitest', 'playwright'],
        testRunners: { vitest: ['tests/unit/**'], playwright: ['tests/browser/**'], node: ['tests/node/**'] },
        rules: { 'vitest/expect-expect': 'error', 'playwright/no-skipped-test': 'error' },
        options: { 'playwright/no-skipped-test': [{ allowConditional: { skip: true } }] },
        overrides: [
          {
            files: ['tests/browser/**'],
            rules: { 'no-restricted-syntax': 'error' },
            options: {
              'no-restricted-syntax': [
                {
                  selector:
                    "CallExpression[callee.object.name='test'][callee.property.name='skip'][arguments.0.value=true]",
                  message: 'Use a project condition instead of permanently skipping this test.'
                }
              ]
            }
          }
        ]
      }
    }
  ])
  const plan = await eslintPlan({
    root,
    policy,
    biomeActive: false,
    typescript: false,
    pluginRoots: [pluginRoot],
    plugins: { vitest, playwright }
  })
  return { root, plan, runner: new ESLint({ cwd: root, overrideConfigFile: true, overrideConfig: plan.config }) }
}

describe('explicit ESLint test runner ownership', () => {
  it('keeps Vitest assertion rules out of node:test files', async () => {
    const { runner } = await prepare()
    const node = await runner.lintText(
      "import { test } from 'node:test'; import assert from 'node:assert/strict'; test('works', () => assert.equal(1, 1));",
      { filePath: 'tests/node/example.js' }
    )
    const missing = await runner.lintText("import { test } from 'vitest'; test('missing assertion', () => {});", {
      filePath: 'tests/unit/example.js'
    })
    expect(
      node.flatMap(report => report.messages).filter(message => message.ruleId === 'vitest/expect-expect')
    ).toEqual([])
    expect(missing.flatMap(report => report.messages).some(message => message.ruleId === 'vitest/expect-expect')).toBe(
      true
    )
  })

  it('permits explicit conditional Playwright project selection while detecting skipped tests', async () => {
    const { runner } = await prepare()
    const conditional = await runner.lintText(
      "import { test } from '@playwright/test'; test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium project');",
      { filePath: 'tests/browser/selection.js' }
    )
    const disabled = await runner.lintText(
      "import { test } from '@playwright/test'; test.skip('disabled case', async () => {});",
      { filePath: 'tests/browser/disabled.js' }
    )
    expect(
      conditional
        .flatMap(report => report.messages)
        .filter(message => message.ruleId?.includes('skip') || message.ruleId?.includes('disabled'))
    ).toEqual([])
    expect(
      disabled.flatMap(report => report.messages).some(message => message.ruleId === 'playwright/no-skipped-test')
    ).toBe(true)
  })

  it('retains an explicit safeguard against permanently true Playwright skip conditions', async () => {
    const { runner } = await prepare()
    const reports = await runner.lintText("import { test } from '@playwright/test'; test.skip(true, 'disabled');", {
      filePath: 'tests/browser/disabled.js'
    })
    expect(reports.flatMap(report => report.messages).some(message => message.ruleId === 'no-restricted-syntax')).toBe(
      true
    )
  })

  it('rejects unknown or empty pack file ownership', async () => {
    const root = project()
    const options = { root, policy: mergeLayers([]), biomeActive: false, typescript: false }
    await expect(eslintPlan({ ...options, packFiles: { nonexistent: ['tests/**'] } })).rejects.toThrow(
      'Unknown packFiles'
    )
    await expect(eslintPlan({ ...options, packFiles: { vitest: [] } })).rejects.toThrow('nonempty')
  })
})
