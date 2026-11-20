import { Linter } from 'eslint'
import { describe, expect, it } from 'vitest'
import { type Guard, getGuard, importRestrictions } from '../src/catalog/guards.ts'
import { check } from '../src/check/check.ts'
import { defaultPolicy } from '../src/policy/load.ts'
import { applyInit, planInit } from '../src/setup/init.ts'
import { link, project } from './helpers.ts'

/** One guard's code patterns, with a file they must catch at the given lines and one they must leave alone. */
interface Case {
  guard: string
  dependency: string
  bad: string
  lines: number[]
  fine: string
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
`,
    lines: [3, 4, 5, 6, 7, 8, 9],
    fine: `import { z } from 'zod'

export const a = z.string().nullish()
export const b = z.strictObject({ name: z.string() })
export const c = z.looseObject({ name: z.string() })
export const d = z.string().trim().min(1).max(10)
export const e = z.string().optional().meta({ id: 'name' })
export const f = z.string().meta({ id: 'name' }).meta({ title: 'Name' })
export const g = z.string().meta({ id: 'name' }).parse('x')
export const h = z.object({ name: z.string() }).partial()
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
`,
    lines: [5, 6, 7, 8],
    fine: `import { render, screen } from '@testing-library/react'

export const run = async (repository) => {
  render(null)
  await screen.findByText('Save')
  await screen.findAllByRole('button')
  screen.getByText('Save')
  await repository.getById(1)
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
  for (const { guard: name, dependency, bad, lines, fine } of CASES) {
    it(`${name}: the GritQL patterns catch the same lines as ESLint, and nothing in the fine code`, async () => {
      const guard = guardNamed(name)
      const root = project({
        'package.json': { name: 'fixture', type: 'module', dependencies: { [dependency]: '*' } },
        'src/bad.js': bad,
        'src/fine.js': fine
      })

      link(root)

      const plan = await planInit({ root, install: false, editor: false })

      applyInit(plan)

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
