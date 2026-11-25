import { join } from 'node:path'
import { ESLint, type Linter } from 'eslint'
import { describe, expect, it } from 'vitest'
import { eslintPlan, mergeLayers } from '../src/index.ts'
import { type PolicyInput } from '../src/types.ts'
import { pluginRoot } from './fixtures/eslint/plugins.ts'
import { project, write } from './helpers.ts'

// The scripts of a component hold the same mistakes as any script. Each one is valid otherwise:
// what the template uses is used, and the props interface is what the framework reads.
const COMPONENTS = {
  vue: {
    file: 'src/MyCounter.vue',
    source: `<script setup lang="ts">
import { ref } from 'vue'

interface Props {
  title: string
}

const props = defineProps<Props>()
const count = ref(0)
var legacy = 1
const unused = 2
const loose: any = 3
debugger
if (count.value == 1) count.value = legacy

function bump(): void {
  count.value++
}
</script>

<template>
  <button
    type="button"
    @click="bump"
  >
    {{ props.title }} {{ count }} {{ loose }}
  </button>
</template>
`
  },
  svelte: {
    file: 'src/Counter.svelte',
    source: `<script lang="ts">
  interface Props {
    title: string
  }

  const { title }: Props = $props()
  let count = $state(0)
  var legacy = 1
  const unused = 2
  const loose: any = 3
  debugger
  if (count == 1) count = legacy
</script>

<button type="button" onclick={() => count++}>{title} {count} {loose}</button>
`
  },
  astro: {
    file: 'src/components/Card.astro',
    source: `---
interface Props {
  title: string
}

const { title } = Astro.props
var legacy = 1
const unused = 2
const loose: any = 3
debugger
const same = title == 'x'
---

<h2>{title} {legacy} {loose} {same}</h2>
`
  }
} as const

type Kind = keyof typeof COMPONENTS

const MISTAKES = [
  'no-var',
  '@typescript-eslint/no-unused-vars',
  '@typescript-eslint/no-explicit-any',
  'no-debugger',
  'eqeqeq'
]

const componentProject = (kind: Kind): string =>
  project({
    'package.json': { name: `${kind}-components`, type: 'module' },
    'tsconfig.json': { compilerOptions: { strict: true, noEmit: true }, include: ['src/**/*.ts'] },
    'src/index.ts': 'export const value = 1\n',
    [COMPONENTS[kind].file]: COMPONENTS[kind].source
  })

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
  it.each(Object.keys(COMPONENTS) as Kind[])(
    'reports the core and TypeScript rules in a %s component, through its parser',
    async kind => {
      const root = componentProject(kind)
      const plan = await planFor(root, kind)

      expect(plan.activePacks).toContain(kind)

      const messages = await lint(root, plan.config, COMPONENTS[kind].file)

      expect(messages.filter(message => message.fatal)).toEqual([])
      for (const rule of MISTAKES) expect(ruleIds(messages), rule).toContain(rule)
      // One finding per mistake: the core rule a typescript-eslint rule stands in for stays off.
      expect(ruleIds(messages).filter(rule => rule.endsWith('no-unused-vars'))).toEqual([
        '@typescript-eslint/no-unused-vars'
      ])
      expect(messages.filter(message => message.ruleId?.endsWith('no-unused-vars'))).toEqual([
        expect.objectContaining({ message: expect.stringContaining("'unused'") })
      ])
    },
    60_000
  )

  it.each(Object.keys(COMPONENTS) as Kind[])(
    'leaves out the rules that need type information in a %s component, which has no program',
    async kind => {
      const root = componentProject(kind)
      const plan = await planFor(root, kind, { rules: { '@typescript-eslint/no-floating-promises': 'error' } })
      const runner = new ESLint({ cwd: root, overrideConfigFile: true, overrideConfig: plan.config as Linter.Config[] })
      const config = (await runner.calculateConfigForFile(join(root, COMPONENTS[kind].file))) as Linter.Config

      expect(config.languageOptions?.parserOptions).not.toMatchObject({ projectService: true })
      expect(config.rules?.['@typescript-eslint/no-floating-promises']).toBeUndefined()

      // The TypeScript file next to it keeps them.
      const script = (await runner.calculateConfigForFile(join(root, 'src/index.ts'))) as Linter.Config

      expect(script.rules?.['@typescript-eslint/no-floating-promises']).toEqual([2])
    },
    60_000
  )

  it('reads the TypeScript of a Svelte module with the Svelte parser, with its type information', async () => {
    const root = componentProject('svelte')
    const file = 'src/counter.svelte.ts'

    // eslint-plugin-svelte hands .svelte.ts files to its own parser, which reads them as JavaScript
    // unless the config names another parser for their scripts.
    const plan = await planFor(root, 'svelte', { rules: { '@typescript-eslint/no-floating-promises': 'error' } })

    write(root, { [file]: 'export const count: number = $state(0)\nvar legacy = count\nPromise.resolve(legacy)\n' })

    const messages = await lint(root, plan.config, file)

    expect(messages.filter(message => message.fatal)).toEqual([])
    expect(ruleIds(messages)).toEqual(expect.arrayContaining(['no-var', '@typescript-eslint/no-floating-promises']))
  }, 60_000)

  it.each(Object.keys(COMPONENTS) as Kind[])(
    'leaves the core rules of a %s component to Biome, where Biome is the linter',
    async kind => {
      const root = componentProject(kind)
      const plan = await planFor(root, kind, { packs: [kind, 'typescript'] }, true)
      const messages = await lint(root, plan.config, COMPONENTS[kind].file)

      expect(messages.filter(message => message.fatal)).toEqual([])
      expect(ruleIds(messages).filter(rule => !rule.startsWith(`${kind}/`))).toEqual([])
    },
    60_000
  )

  it('applies a policy override and a locked floor to component scripts once', async () => {
    const root = componentProject('vue')
    const { file } = COMPONENTS.vue
    const overridden = await planFor(root, 'vue', {
      overrides: [{ files: ['src/**'], rules: { 'no-unused-vars': 'off' } }]
    })

    expect(ruleIds(await lint(root, overridden.config, file)).filter(rule => rule.endsWith('no-unused-vars'))).toEqual(
      []
    )

    const locked = await planFor(root, 'vue', { rules: { 'no-unused-vars': 'warn' }, locked: ['no-unused-vars'] })
    const messages = await lint(root, locked.config, file)

    expect(messages.filter(message => message.ruleId?.endsWith('no-unused-vars'))).toEqual([
      expect.objectContaining({ ruleId: '@typescript-eslint/no-unused-vars', severity: 1 })
    ])
  }, 60_000)
})
