import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { extraGlobals, ownGlobals } from '../src/catalog/runtimes.ts'
import { check } from '../src/check/check.ts'
import { biomeConfig, biomeProjectConfig } from '../src/engines/biome/config.ts'
import { eslintPlan } from '../src/engines/eslint/plan.ts'
import { checkOxlintConfig, mergeOxlintConfig, oxlintConfig } from '../src/engines/oxlint/config.ts'
import { defaultPolicy } from '../src/policy/merge.ts'
import { planInit } from '../src/setup/init.ts'
import { applyPlan } from '../src/setup/plan.ts'
import { link, PACKAGE_ROOT, project, write } from './helpers.ts'

describe('runtime globals in each engine', () => {
  it('name for Biome only what it does not know: it has the Node and browser globals', () => {
    expect(extraGlobals(['node', 'browser'])).toEqual([])
    expect(biomeConfig(defaultPolicy(), { runtimes: ['node', 'bun'] }).javascript).toMatchObject({ globals: ['Bun'] })
    expect(biomeProjectConfig(defaultPolicy(), { runtimes: ['worker'] })).toEqual({
      extends: ['@santi020k/pawl/biome'],
      javascript: { globals: ['HTMLRewriter', 'WebSocketPair'] }
    })
    expect(biomeProjectConfig(defaultPolicy(), { runtimes: ['node', 'browser'] })).not.toHaveProperty('javascript')
  })

  it("use Oxlint's own environments, with globals for the rest", () => {
    expect(oxlintConfig(defaultPolicy())).toMatchObject({ env: { browser: true, builtin: true, node: true } })
    expect(oxlintConfig(defaultPolicy(), { runtimes: ['deno'] })).toMatchObject({
      env: { builtin: true, 'shared-node-browser': true },
      globals: { Deno: 'readonly' }
    })
  })

  it("keep the env and globals a project added to .oxlintrc.json, such as a test framework's", () => {
    const root = project({})
    const expected = oxlintConfig(defaultPolicy(), { runtimes: ['node'] })
    const own = mergeOxlintConfig({ env: { vitest: true }, globals: { myGlobal: 'writable' } }, expected)

    write(root, { '.oxlintrc.json': own })
    expect(own.env).toEqual({ vitest: true, builtin: true, node: true })
    expect(checkOxlintConfig(root, defaultPolicy(), { runtimes: ['node'] }).status).toBe('ok')
    expect(checkOxlintConfig(root, defaultPolicy(), { runtimes: ['node', 'bun'] }).status).toBe('stale')
  })

  it('give ESLint the globals of each runtime, and no browser globals for server code', async () => {
    const globalsOf = async (runtimes: Parameters<typeof ownGlobals>[0]) => {
      const plan = await eslintPlan({
        root: project({ 'package.json': { name: 'fixture' } }),
        policy: defaultPolicy(),
        biomeActive: true,
        typescript: false,
        runtimes
      })

      return (plan.config.find(entry => entry.name === 'pawl/base') as { languageOptions: { globals: object } })
        .languageOptions.globals
    }

    const server = await globalsOf(['node'])
    const edge = await globalsOf(['worker'])

    expect(server).toHaveProperty('process')
    expect(server).not.toHaveProperty('document')
    expect(edge).toHaveProperty('HTMLRewriter')
    expect(edge).not.toHaveProperty('process')
    expect(ownGlobals(['node'])).not.toContain('window')
    expect(ownGlobals(['browser'])).toContain('window')
  })
})

describe('runtime globals, with the real engines', { timeout: 60_000 }, () => {
  const source = 'export const server = Bun.serve({})\nexport const title = document.title\n'
  const undeclared = (result: Awaited<ReturnType<typeof check>>): string[] =>
    result.findings
      .filter(finding => finding.rule === 'no-undef')
      .map(finding => finding.message)
      .sort()

  it('let Biome know Bun when the project runs on it', async () => {
    const root = project({
      'package.json': { name: 'fixture', private: true, type: 'module', devDependencies: { 'bun-types': '1' } },
      'src/a.js': source
    })

    link(root)
    applyPlan(await planInit({ root, install: false, editor: false }))

    // Biome knows the browser globals whatever the runtime, so only Bun was ever in question.
    expect(undeclared(await check({ root }))).toEqual([])

    write(root, { 'pawl.config.json': { runtime: 'node' } })
    applyPlan(await planInit({ root, install: false, editor: false }))

    expect(undeclared(await check({ root }))).toEqual(['The Bun variable is undeclared.'])
  })

  it('let Oxlint know only the globals of the runtimes in use', async () => {
    const root = project({
      'package.json': { name: 'fixture', private: true, type: 'module' },
      'pawl.config.json': { engine: 'oxlint', runtime: ['node', 'bun'] },
      'src/a.js': source
    })

    link(root)
    applyPlan(await planInit({ root, engine: 'oxlint', install: false, editor: false }))

    expect(undeclared(await check({ root }))).toEqual(["'document' is not defined."])
  })

  it.runIf(existsSync(join(PACKAGE_ROOT, 'dist/index.js')))(
    'let ESLint know only the globals of the runtimes in use',
    async () => {
      const root = project({
        'package.json': { name: 'fixture', private: true, type: 'module' },
        'pawl.config.json': { engine: 'eslint', formatter: 'prettier', runtime: 'browser' },
        '.prettierrc.json': '{}\n',
        'eslint.config.js':
          "import { eslint } from '@santi020k/pawl'\n\nexport default eslint({ root: import.meta.dirname })\n",
        'src/a.js': source
      })

      link(root, { eslint: true, prettier: true })

      const result = await check({ root })

      expect(result.setup.filter(issue => issue.code === 'engine-failed')).toEqual([])
      expect(undeclared(result)).toEqual(["'Bun' is not defined."])
    }
  )
})
