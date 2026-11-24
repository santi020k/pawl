import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BIOME_VERSION } from '../src/engines/biome/config.ts'
import { runBiome } from '../src/engines/biome/run.ts'
import { doctor, formatDoctor } from '../src/report/doctor.ts'
import { link, project, write } from './helpers.ts'

const config = {
  formatter: { enabled: false },
  assist: { enabled: false },
  linter: { enabled: true, rules: { recommended: false, correctness: { noUnresolvedImports: 'error' } } }
}

const fixture = (): string => {
  const root = project({
    'package.json': { name: 'astro-coverage', dependencies: { astro: '^7.4.0' } },
    'pawl.config.json': { engine: 'biome' },
    'biome.json': config
  })

  link(root)

  return root
}

describe(`Astro coverage with Biome ${BIOME_VERSION}`, () => {
  it('proves a scoped parser opt-in misses an invalid expression that the root option diagnoses', async () => {
    const root = fixture()
    const file = 'invalid.astro'

    write(root, {
      [file]: '---\n---\n<div {not valid ? }></div>\n',
      'biome.json': {
        ...config,
        overrides: [{ includes: ['**/*.astro'], html: { experimentalFullSupportEnabled: true } }]
      }
    })
    const scoped = await runBiome({ root, files: [file] })

    expect(scoped.findings.filter(finding => finding.engineRule === 'parse')).toEqual([])

    write(root, { 'biome.json': { ...config, html: { experimentalFullSupportEnabled: true } } })
    const global = await runBiome({ root, files: [file] })

    expect(global.findings).toContainEqual(expect.objectContaining({ file, engineRule: 'parse', severity: 'error' }))
  })

  it('reports the host import limitation without hiding misspelled ordinary imports', async () => {
    const root = fixture()

    write(root, {
      'Page.astro': '<h1>Hello</h1>\n',
      'valid.ts': 'export const valid = 1;\n',
      'imports.ts': [
        'import { getCollection } from "astro:content";',
        'import { navigate } from "astro:transitions/client";',
        'import Page from "./Page.astro";',
        'import { valid } from "./valid";',
        'import missing from "./missing";',
        'export { getCollection, navigate, Page, valid, missing };\n'
      ].join('\n')
    })
    const before = readFileSync(join(root, 'biome.json'), 'utf8')
    const report = await doctor(root)
    const result = await runBiome({ root, files: ['imports.ts'] })
    const imports = result.findings.filter(finding => finding.rule === 'import/no-unresolved')

    expect(imports.map(finding => finding.line)).toEqual([1, 2, 3, 5])
    expect(report.limitations).toHaveLength(2)
    expect(report.limitations.join(' ')).toContain('astro check and astro build')
    expect(report.limitations.join(' ')).toContain('scoped opt-in is not proof')
    expect(formatDoctor(report)).toContain('Coverage: Biome')
    expect(readFileSync(join(root, 'biome.json'), 'utf8')).toBe(before)
  })

  it('does not apply Astro allowances or notices to unrelated hosts', async () => {
    const root = fixture()

    write(root, { 'package.json': { name: 'ordinary', dependencies: { react: '^19.0.0' } } })

    expect((await doctor(root)).limitations).toEqual([])
  })

  it('includes Astro workspace packages in the coverage notice', async () => {
    const root = fixture()

    write(root, {
      'package.json': { name: 'workspace', workspaces: ['apps/*'] },
      'apps/docs/package.json': { name: 'docs', dependencies: { astro: '^7.4.0' } }
    })

    expect((await doctor(root)).limitations).toHaveLength(2)
  })
})
