import { ESLint, type Linter } from 'eslint'
import { describe, expect, it } from 'vitest'
import { eslintPlan, mergeLayers } from '../src/index.ts'
import { type PolicyInput } from '../src/types.ts'
import { pluginRoot } from './fixtures/eslint/plugins.ts'
import { project } from './helpers.ts'

type Kind = 'vue' | 'svelte' | 'astro'

const planFor = (root: string, kind: Kind, input: PolicyInput = {}, biomeActive = false) =>
  eslintPlan({
    root,
    policy: mergeLayers([{ source: 'repo', input: { packs: [kind], ...input } }]),
    biomeActive,
    typescript: true,
    technologies: [kind],
    pluginRoots: [pluginRoot]
  })

const lint = async (root: string, config: unknown[], file: string): Promise<Linter.LintMessage[]> => {
  const runner = new ESLint({ cwd: root, overrideConfigFile: true, overrideConfig: config as Linter.Config[] })

  return (await runner.lintFiles([file])).flatMap(report => report.messages)
}

const ruleIds = (messages: readonly Linter.LintMessage[]): string[] =>
  messages.flatMap(message => (message.ruleId === null ? [] : [message.ruleId]))

describe('the standard in component scripts', () => {
  it('reads the TypeScript of a Svelte module with the Svelte parser, with its type information', async () => {
    const file = 'src/counter.svelte.ts'
    const root = project({
      'package.json': { name: 'svelte-modules', type: 'module' },
      'tsconfig.json': { compilerOptions: { strict: true, noEmit: true }, include: ['src/**/*.ts'] },
      [file]: 'export const count: number = $state(0)\nvar legacy = count\nPromise.resolve(legacy)\n'
    })

    // eslint-plugin-svelte hands .svelte.ts files to its own parser, which reads them as JavaScript
    // unless the config names another parser for their scripts.
    const plan = await planFor(root, 'svelte', { rules: { '@typescript-eslint/no-floating-promises': 'error' } })
    const messages = await lint(root, plan.config, file)

    expect(messages.filter(message => message.fatal)).toEqual([])
    expect(ruleIds(messages)).toEqual(expect.arrayContaining(['no-var', '@typescript-eslint/no-floating-promises']))
  }, 60_000)
})
