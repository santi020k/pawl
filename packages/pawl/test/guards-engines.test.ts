import { Linter } from 'eslint'
import { describe, expect, it } from 'vitest'
import { type Guard, getGuard, importRestrictions } from '../src/catalog/guards.ts'
import { check } from '../src/check/check.ts'
import { defaultPolicy } from '../src/policy/merge.ts'
import { planInit } from '../src/setup/init.ts'
import { applyPlan } from '../src/setup/plan.ts'
import { link, project } from './helpers.ts'

/** One guard's code patterns, with a file they must catch at the given lines and one they must leave alone. */
interface Case {
  guard: string
  dependency: string
  bad: string
  lines: number[]
  fine: string
  /** For an opt-in guard, the packs the policy names. */
  packs?: string[]
}

const CASES: Case[] = [
  {
    guard: 'zod',
    dependency: 'zod',
    bad: `import { z } from 'zod'

export const a = z.string().optional().nullable()
export const b = z.string().nullable().optional()
export const c = z.object({ name: z.string() }).strict()
export const d = z.object({ name: z.string() }).passthrough()
export const e = z.object({ name: z.string() }).loose()
export const f = z.string().min(1, 'Required').trim()
export const g = z.string().meta({ id: 'name' }).optional()
export const h = z.union([z.literal('a'), z.literal("b")])
export const i = z.union([
  z.literal('x'),
  z.literal('it\\'s'),
])
`,
    lines: [3, 4, 5, 6, 7, 8, 9, 10, 11],
    fine: `import { z } from 'zod'

export const a = z.string().nullish()
export const b = z.strictObject({ name: z.string() })
export const c = z.looseObject({ name: z.string() })
export const d = z.string().trim().min(1).max(10)
export const e = z.string().optional().meta({ id: 'name' })
export const f = z.string().meta({ id: 'name' }).meta({ title: 'Name' })
export const g = z.string().meta({ id: 'name' }).parse('x')
export const h = z.object({ name: z.string() }).partial()
export const i = z.enum(['a', 'b'])
export const j = z.union([z.literal('a'), z.literal(1)])
export const k = z.union([z.literal('a'), z.string()])
export const l = z.union([z.literal('a')])
export const m = z.union([z.literal(1), z.literal(2)])
export const n = z.union([z.literal('a'), z.literal(\`b\`)])
export const o = z.union([z.literal('a'), z.literal('b'), ...extra])
export const p = z.union([z.literal('a'), z.literal('b')], { error: 'No' })
export const q = z.union(options)
// Zod 3 and the AI SDK's tool schemas write .describe(), which the opt-in zod-meta guard refuses.
export const r = z.string().describe('Name')
`
  },
  {
    guard: 'zod-meta',
    dependency: 'zod',
    packs: ['zod-meta'],
    bad: `import { z } from 'zod'

export const j = z.string().describe('Name')
export const k = z.string().min(1).describe('Name')
export const l = z.array(z.string()).max(3).optional().describe('List')
`,
    lines: [3, 4, 5],
    fine: `import { z } from 'zod'

export const r = z.string().meta({ description: 'Name' })
export const s = z.string().describe
test.describe('suite', () => {})
describe('suite', () => {})
suite.describe('suite')
`
  },
  {
    guard: 'testing-library',
    dependency: '@testing-library/react',
    bad: `import { getByLabelText, render, screen, within } from '@testing-library/react'

export const run = async () => {
  render(null)
  await screen.getByText('Save')
  await screen.queryAllByRole('button')
  await within(screen.getByRole('list')).getAllByText('Item')
  await getByLabelText(document.body, 'Name')
}

export const queries = () => {
  const { getByText, container } = render(null)
  const { queryAllByRole: roles } = render(null)
  const { getByRole } = render(
    null
  )

  return [getByText, roles, getByRole, container, render(null).findByText('x')]
}
`,
    lines: [5, 6, 7, 8, 12, 13, 14, 18],
    fine: `import { render, screen } from '@testing-library/react'

export const run = async (repository) => {
  render(null)
  await screen.findByText('Save')
  await screen.findAllByRole('button')
  screen.getByText('Save')
  await repository.getById(1)
}

export const queries = (element) => {
  const { container, rerender, unmount } = render(null)
  const { getByText } = within(element)
  const { getByRole } = other(null)
  const { queryClient } = render(null)

  return [container, rerender, unmount, getByText, getByRole, queryClient, screen.getByText('x')]
}
`
  },
  {
    guard: 'testing-library-debug',
    dependency: '@testing-library/react',
    bad: `import { logRoles, prettyDOM, screen } from '@testing-library/react'

export const show = () => {
  screen.debug()
  screen.logTestingPlaygroundURL()
  logRoles(document.body)
  return prettyDOM(document.body)
}
`,
    lines: [4, 5, 6, 7],
    fine: `import { render } from '@testing-library/react'

export const show = (logger) => {
  const { debug } = render(null)

  logger.debug('done')
  return debug
}
`
  },
  {
    guard: 'testing-library-find-by',
    dependency: '@testing-library/react',
    bad: `import { screen, waitFor } from '@testing-library/react'

export const run = async (view) => {
  await waitFor(() => screen.getByText('Save'))
  await waitFor(() => screen.queryAllByRole('button'))
  await waitFor(() => view.getByLabelText('Name'))
  await waitFor(() => getByText('Save'))
  await waitFor(() => expect(screen.getByText('Save')).toBeInTheDocument())
  await waitFor(() => expect(queryByText('Save')).toBeInTheDocument())
  await waitFor(async () => screen.getByText('Save'))
}
`,
    lines: [4, 5, 6, 7, 8, 9, 10],
    fine: `import { screen, waitFor, waitForElementToBeRemoved } from '@testing-library/react'

export const run = async (repository, mock) => {
  await screen.findByText('Save')
  await waitFor(() => expect(mock).toHaveBeenCalled())
  await waitFor(() => expect(screen.queryByText('Save')).not.toBeInTheDocument())
  await waitFor(() => expect(screen.getByText('Save')).toHaveTextContent('Save'))
  await waitFor(() => screen.getByText('Save'), { timeout: 100 })
  await waitFor(() => {
    screen.getByText('Save')
  })
  await waitFor(() => repository.getById(1))
  await waitFor(() => screen.getByText)
  await wait(() => screen.getByText('Save'))
  await waitForElementToBeRemoved(() => screen.queryByText('Save'))
}
`
  },
  {
    guard: 'nuxt',
    dependency: 'nuxt',
    bad: `export const flags = [
  process.client,
  process.server,
  process.browser,
  process.nitro,
  process.dev,
  process.test,
  process.prerender
]
`,
    lines: [2, 3, 4, 5, 6, 7, 8],
    fine: `export const flags = [import.meta.client, import.meta.server, process.env.NODE_ENV, process.cwd(), process['client']]
`
  }
]

const guardNamed = (name: string): Guard => {
  const guard = getGuard(name)

  if (!guard) throw new Error(`No guard named ${name}`)

  return guard
}

/** The lines the guard's selectors catch, run through the real ESLint. */
const eslintLines = (guard: Guard, code: string): number[] => {
  const options = (guard.syntax ?? []).map(({ selector, message }) => ({ selector, message }))
  const messages = new Linter().verify(code, [
    {
      languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
      rules: { 'no-restricted-syntax': ['error', ...options] }
    }
  ])

  expect(messages.every(message => message.ruleId === 'no-restricted-syntax')).toBe(true)

  return messages.map(message => message.line).sort((a, b) => a - b)
}

describe('library guards, run by the real ESLint', () => {
  for (const { guard: name, bad, lines, fine } of CASES) {
    it(`${name}: the selectors catch the bad code and leave the fine code alone`, () => {
      const guard = guardNamed(name)

      expect(eslintLines(guard, bad)).toEqual(lines)
      expect(eslintLines(guard, fine)).toEqual([])
    })
  }
})

describe('library guards, run by the real Biome', { timeout: 60_000 }, () => {
  for (const { guard: name, dependency, bad, lines, fine, packs } of CASES) {
    it(`${name}: the GritQL patterns catch the same lines as ESLint, and nothing in the fine code`, async () => {
      const guard = guardNamed(name)
      const root = project({
        'package.json': { name: 'fixture', type: 'module', dependencies: { [dependency]: '*' } },
        ...(packs ? { 'pawl.config.json': { packs } } : {}),
        'src/bad.js': bad,
        'src/fine.js': fine
      })

      link(root)

      const plan = await planInit({ root, install: false, editor: false })

      applyPlan(plan)

      expect(plan.actions.map(action => action.path)).toContain(`.pawl/rules/${name}.grit`)

      const result = await check({ root })
      const own = result.findings
        .filter(finding => finding.rule === `pawl/${name}`)
        .map(finding => `${finding.file}:${finding.line} ${finding.severity}`)
        .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))

      expect(own).toEqual(lines.map(line => `src/bad.js:${line} ${guard.level ?? 'error'}`))
    })
  }
})

describe('the Testing Library DOM import guard', () => {
  it('refuses the DOM package next to a framework, and leaves a project without one alone', () => {
    const framework = importRestrictions(defaultPolicy(), ['@testing-library/react'])

    expect(Object.keys(framework?.biome.paths ?? {})).toEqual(['@testing-library/dom', 'dom-testing-library'])
    expect(importRestrictions(defaultPolicy(), ['@testing-library/dom'])).toBeUndefined()
  })
})
