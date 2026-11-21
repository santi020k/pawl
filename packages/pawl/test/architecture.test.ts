import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PACKAGE_ROOT } from './helpers.ts'

/** The layers of src, lowest first. A module may import from its own layer or a lower one. See AGENTS.md. */
const LAYERS = ['utils', 'catalog', 'project', 'policy', 'engines', 'scans', 'check', 'report', 'setup', 'cli']

const SRC = join(PACKAGE_ROOT, 'src')

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? sources(join(dir, entry.name)) : entry.name.endsWith('.ts') ? [join(dir, entry.name)] : []
  )

/** Every module of src and the modules it imports, both relative to src. */
const graph = new Map(
  sources(SRC).map(file => [
    relative(SRC, file),
    [...readFileSync(file, 'utf8').matchAll(/from '(\.{1,2}\/[^']+)'/g)].map(([, spec]) =>
      relative(SRC, resolve(dirname(file), spec as string))
    )
  ])
)

/** The layer of a module, or undefined for the modules at the top of src: the entry points and the shared types. */
const layerOf = (module: string): number | undefined => {
  const folder = module.includes('/') ? module.slice(0, module.indexOf('/')) : undefined

  return folder === undefined ? undefined : LAYERS.indexOf(folder)
}

describe('the architecture', () => {
  it('puts every folder of src in a layer', () => {
    const folders = new Set(
      [...graph.keys()].filter(module => module.includes('/')).map(module => module.split('/')[0])
    )

    expect([...folders].filter(folder => !LAYERS.includes(folder as string))).toEqual([])
  })

  it('never imports from a higher layer', () => {
    const upward = [...graph].flatMap(([module, imports]) =>
      imports.flatMap(target => {
        const from = layerOf(module)
        const to = layerOf(target)

        return from !== undefined && to !== undefined && to > from ? [`${module} -> ${target}`] : []
      })
    )

    expect(upward).toEqual([])
  })

  it('keeps the shared modules at the top free of the layers, except the entry points', () => {
    const shared = ['types.ts', 'version.ts']

    expect(shared.flatMap(module => graph.get(module) ?? []).filter(target => target.includes('/'))).toEqual([])
  })

  it('has no import cycles', () => {
    const cycles: string[] = []
    const state = new Map<string, 'visiting' | 'done'>()
    const visit = (module: string, path: string[]): void => {
      if (state.get(module) === 'done') return

      if (state.get(module) === 'visiting') {
        cycles.push([...path.slice(path.indexOf(module)), module].join(' -> '))

        return
      }

      state.set(module, 'visiting')

      for (const target of graph.get(module) ?? []) visit(target, [...path, module])

      state.set(module, 'done')
    }

    for (const module of graph.keys()) visit(module, [])

    expect(cycles).toEqual([])
  })
})
