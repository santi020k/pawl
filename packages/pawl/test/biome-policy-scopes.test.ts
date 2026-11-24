import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, matchesGlob } from 'node:path'
import { describe, expect, it } from 'vitest'
import { check } from '../src/check/check.ts'
import { exitCode } from '../src/check/result.ts'
import { runBiome } from '../src/engines/biome/run.ts'
import { packagePatterns } from '../src/engines/biome/scopes.ts'
import { applyPlan } from '../src/setup/plan.ts'
import { planSync } from '../src/setup/sync.ts'
import { link, project, write } from './helpers.ts'

const source = 'debugger;\n'
const generated = 'export  const value={hello: "world"};\n'

const fixture = (): string => {
  const root = project({
    'package.json': { name: 'scopes', private: true, workspaces: ['apps/*'] },
    'pawl.config.json': {
      engine: 'biome',
      formatter: 'biome',
      ignore: ['apps/docs/generated.js'],
      overrides: [{ files: ['apps/docs/allowed.js'], rules: { 'no-debugger': 'off' } }]
    },
    'apps/docs/package.json': { name: 'docs', dependencies: { astro: '^7.4.0' } },
    'apps/web/package.json': { name: 'web', dependencies: { react: '^19.0.0' } },
    'apps/docs/allowed.js': source,
    'apps/docs/blocked.js': source,
    'apps/docs/apps/docs/allowed.js': source,
    'apps/docs/generated.js': generated,
    'apps/docs/apps/docs/generated.js': generated,
    'apps/web/allowed.js': source
  })

  link(root)

  return root
}

describe('root policy scopes in mixed workspaces', () => {
  it('escapes bracketed workspace roots in domains, projected overrides and nested exclusions', async () => {
    const component = 'export const View = () => <div dangerouslySetInnerHTML={{ __html: "hello" }} />\n'
    const root = project({
      'package.json': { name: 'brackets', private: true, workspaces: ['apps/*', 'apps/*/examples/*'] },
      'pawl.config.json': {
        engine: 'biome',
        overrides: [{ files: ['**/*.jsx'], rules: { 'react/no-danger': 'error' } }]
      },
      'apps/[web]/package.json': { name: 'web', dependencies: { react: '^19.0.0' } },
      'apps/[web]/view.jsx': component,
      'apps/[web]/examples/[plain]/package.json': { name: 'plain' },
      'apps/[web]/examples/[plain]/view.jsx': component
    })
    link(root)
    applyPlan(await planSync(root))
    const result = await check({ root })
    expect(result.setup).toEqual([])
    expect(result.findings.filter(finding => finding.rule === 'react/no-danger').map(finding => finding.file)).toEqual([
      'apps/[web]/view.jsx'
    ])
  })

  it.each([
    { files: ['apps/[web]/*.jsx'], allowed: ['[web]/view.jsx', '[web]/excluded.jsx'] },
    { files: ['apps/\\[web\\]/*.jsx'], allowed: ['[web]/view.jsx', '[web]/excluded.jsx'] },
    { files: ['apps/[web]/*.jsx', '!apps/[web]/excluded.jsx'], allowed: ['[web]/view.jsx'] },
    { files: ['apps/*[web]/*.jsx'], allowed: ['[web]/view.jsx', '[web]/excluded.jsx', 'prefix[web]/view.jsx'] },
    { files: ['apps/[web*]/*.jsx'], allowed: ['[web]/view.jsx', '[web]/excluded.jsx', '[web-two]/view.jsx'] },
    {
      files: ['apps/{[web],[web-two]}/*.jsx', '!apps/[web]/excluded.jsx'],
      allowed: ['[web]/view.jsx', '[web-two]/view.jsx']
    },
    { files: ['apps/**/[web]/*.jsx'], allowed: ['[web]/view.jsx', '[web]/excluded.jsx'] }
  ])('preserves literal brackets while projecting $files', async ({ files, allowed }) => {
    const component = 'export const View = () => <div dangerouslySetInnerHTML={{ __html: "hello" }} />\n'
    const folders = ['[web]', '[web-two]', 'prefix[web]', 'web', 'w']
    const paths = [...folders.map(folder => `${folder}/view.jsx`), '[web]/excluded.jsx']
    const root = project({
      'package.json': { name: 'literal-scopes', private: true, workspaces: ['apps/*'] },
      'pawl.config.json': {
        engine: 'biome',
        rules: { 'react/no-danger': 'error' },
        overrides: [{ files, rules: { 'react/no-danger': 'off' } }]
      },
      ...Object.fromEntries(
        folders.map(folder => [
          `apps/${folder}/package.json`,
          { name: `fixture-${folder}`, dependencies: { react: '^19.0.0' } }
        ])
      ),
      ...Object.fromEntries(paths.map(path => [`apps/${path}`, component]))
    })
    link(root)
    applyPlan(await planSync(root))
    const result = await check({ root })
    expect(result.setup).toEqual([])
    expect(
      result.findings
        .filter(finding => finding.rule === 'react/no-danger')
        .map(finding => finding.file)
        .sort()
    ).toEqual(
      paths
        .filter(path => !allowed.includes(path))
        .map(path => `apps/${path}`)
        .sort()
    )
  })

  it.each([
    [
      'vue',
      '<script setup lang="ts">\nimport { Status } from "./types"\ndefineProps<{ status: Status }>()\n</script>\n<template>{{ Status.Active }}</template>\n'
    ],
    [
      'svelte',
      '<script lang="ts">\nimport { Status } from "./types"\nexport let status: Status\n</script>\n{Status.Active}\n'
    ],
    [
      'astro',
      '---\nimport { Status } from "./types"\nconst status: Status = Astro.props.status\n---\n<p>{Status.Active}</p>\n'
    ]
  ])('keeps globally scoped import rules out of %s package overrides during fix', async (technology, component) => {
    const root = project({
      'package.json': { name: 'components', private: true, workspaces: ['apps/*'] },
      'pawl.config.json': { engine: 'biome', rules: { 'biome:style/useImportType': 'error' } },
      'apps/component/package.json': { name: 'component', dependencies: { [technology]: '*' } },
      [`apps/component/view.${technology}`]: component,
      'apps/component/types.ts': "export enum Status { Active = 'active' }\n",
      'apps/component/plain.ts':
        "import { Status } from './types'\nexport const identity = (status: Status): Status => status\n"
    })
    link(root)
    applyPlan(await planSync(root))
    const result = await check({ root, fix: true })
    expect(result.setup).toEqual([])
    const fixed = readFileSync(join(root, `apps/component/view.${technology}`), 'utf8')
    expect(fixed).toMatch(/import \{ Status \}/)
    expect(fixed).not.toContain('import type')
    expect(readFileSync(join(root, 'apps/component/plain.ts'), 'utf8')).toMatch(
      /import (?:type \{ Status \}|\{ type Status \})/
    )
  })

  it('preserves unowned inline overrides and refuses to fix until they are reconciled', async () => {
    const root = fixture()
    const config = {
      extends: ['@santi020k/pawl/biome'],
      overrides: [{ includes: ['tests/**'], linter: { rules: { suspicious: { noDebugger: 'off' } } } }]
    }
    write(root, { 'biome.json': config })
    const before = readFileSync(join(root, 'biome.json'), 'utf8')
    const plan = await planSync(root)
    expect(plan.actions.some(action => action.path === 'biome.json')).toBe(false)
    expect(plan.notes.join(' ')).toContain('inline overrides whose ownership cannot be established')
    applyPlan(plan)
    expect(readFileSync(join(root, 'biome.json'), 'utf8')).toBe(before)
    const result = await check({ root, fix: true })
    expect(exitCode(result)).toBe(2)
    expect(result.commands).toEqual([])
    expect(readFileSync(join(root, 'apps/docs/blocked.js'), 'utf8')).toBe(source)
  })

  it('keeps exact overrides rooted, including same-named paths beneath a package', async () => {
    const root = fixture()

    applyPlan(await planSync(root))
    const result = await check({ root })

    expect(result.setup).toEqual([])
    expect(
      result.findings
        .filter(finding => finding.rule === 'no-debugger')
        .map(finding => finding.file)
        .sort()
    ).toEqual(['apps/docs/apps/docs/allowed.js', 'apps/docs/blocked.js', 'apps/web/allowed.js'])
  })

  it('leaves ignored generated bytes untouched by fix without widening the ignore', async () => {
    const root = fixture()

    applyPlan(await planSync(root))
    const result = await check({ root, fix: true })

    expect(result.setup).toEqual([])
    expect(readFileSync(join(root, 'apps/docs/generated.js'), 'utf8')).toBe(generated)
    expect(readFileSync(join(root, 'apps/docs/apps/docs/generated.js'), 'utf8')).not.toBe(generated)
  })
  it.each([
    ['biome.json', '{"root":false,"extends":["../../biome.json","@santi020k/pawl/biome/astro"]}\n'],
    [
      'biome.jsonc',
      '{\n // Preserve our parser setting.\n "root": false, "html": {"experimentalFullSupportEnabled": true}\n}\n'
    ]
  ])('refuses a legacy or custom %s without changing it during sync or fix', async (filename, content) => {
    const root = fixture()
    const file = `apps/docs/${filename}`

    write(root, { [file]: content })
    const plan = await planSync(root)

    expect(plan.actions.some(action => action.path === file)).toBe(false)
    expect(plan.notes.join(' ')).toContain(`${file} is a nested Biome config`)
    applyPlan(plan)
    const result = await check({ root, fix: true })

    expect(exitCode(result)).toBe(2)
    expect(result.commands).toEqual([])
    expect(result.setup).toContainEqual(
      expect.objectContaining({
        code: 'biome-config-nested',
        message: `${file} is a nested Biome config that can change root policy scopes.`
      })
    )
    expect(readFileSync(join(root, file), 'utf8')).toBe(content)
    expect(readFileSync(join(root, 'apps/docs/blocked.js'), 'utf8')).toBe(source)
  })
  it('refuses nested configs outside declared workspace roots too', async () => {
    const root = fixture()
    const content = '{"root":false}\n'

    write(root, { 'tools/nested/biome.json': content })
    applyPlan(await planSync(root))
    const result = await check({ root, fix: true })

    expect(exitCode(result)).toBe(2)
    expect(result.commands).toEqual([])
    expect(readFileSync(join(root, 'tools/nested/biome.json'), 'utf8')).toBe(content)
  })

  it('preserves custom root settings with their explicit package scope', async () => {
    const root = fixture()
    const custom = {
      overrides: [{ includes: ['apps/web/*.js'], linter: { rules: { suspicious: { noDebugger: 'off' } } } }]
    }

    write(root, {
      'biome.json': { extends: ['@santi020k/pawl/biome', './biome.custom.json'] },
      'biome.custom.json': custom
    })
    const before = readFileSync(join(root, 'biome.custom.json'), 'utf8')

    applyPlan(await planSync(root))
    const result = await check({ root })

    expect(result.setup).toEqual([])
    expect(readFileSync(join(root, 'biome.custom.json'), 'utf8')).toBe(before)
    expect(
      result.findings
        .filter(finding => finding.rule === 'no-debugger')
        .map(finding => finding.file)
        .sort()
    ).toEqual(['apps/docs/apps/docs/allowed.js', 'apps/docs/blocked.js'])
  })
  it('preserves an explicit root HTML parser opt-in through sync', async () => {
    const root = fixture()

    write(root, {
      'biome.json': { extends: ['@santi020k/pawl/biome'], html: { experimentalFullSupportEnabled: true } },
      'apps/docs/invalid.astro': '---\n---\n<div {not valid ? }></div>\n'
    })
    applyPlan(await planSync(root))
    const result = await check({ root })

    expect(result.setup).toEqual([])
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        file: 'apps/docs/invalid.astro',
        engineRule: 'parse',
        severity: 'error',
        message: 'Template expressions can only contain a single expression'
      })
    )
  })
  it('keeps package parser support when Biome formats for another linter', async () => {
    const root = fixture()

    write(root, {
      'pawl.config.json': { engine: 'eslint', formatter: 'biome' },
      'apps/docs/package.json': { name: 'docs', dependencies: { tailwindcss: '^4.0.0' } },
      'apps/docs/style.css': '@theme { --color-brand: blue; }\n'
    })
    applyPlan(await planSync(root))
    const result = await runBiome({ root, files: ['apps/docs/style.css'], write: true })

    expect(result.findings.filter(finding => finding.engineRule === 'parse')).toEqual([])
    expect(readFileSync(join(root, 'apps/docs/style.css'), 'utf8')).not.toBe('@theme { --color-brand: blue; }\n')
    expect(readFileSync(join(root, 'biome.json'), 'utf8')).toContain('tailwindDirectives')
  })
  it('finds an ignored governing config through the source file ancestry', async () => {
    const root = fixture()
    const content = '{"root":false,"linter":{"rules":{"suspicious":{"noDebugger":"off"}}}}\n'

    write(root, { '.gitignore': 'apps/docs/biome.json\n', 'apps/docs/biome.json': content })
    execFileSync('git', ['init', '--quiet'], { cwd: root })
    applyPlan(await planSync(root))
    const result = await check({ root, fix: true })

    expect(exitCode(result)).toBe(2)
    expect(result.commands).toEqual([])
    expect(readFileSync(join(root, 'apps/docs/biome.json'), 'utf8')).toBe(content)
    expect(result.setup).toContainEqual(expect.objectContaining({ code: 'biome-config-nested' }))
  })

  it('finds ignored directory configs when the policy disables Git ignores', async () => {
    const root = fixture()

    write(root, {
      '.gitignore': 'hidden/\n',
      'pawl.config.json': { engine: 'biome', gitignore: false },
      'hidden/biome.json': { root: false },
      'hidden/source.js': source
    })
    execFileSync('git', ['init', '--quiet'], { cwd: root })
    const result = await check({ root })

    expect(exitCode(result)).toBe(2)
    expect(result.setup).toContainEqual(
      expect.objectContaining({
        code: 'biome-config-nested',
        message: 'hidden/biome.json is a nested Biome config that can change root policy scopes.'
      })
    )
  })

  it.each([
    ['**/*.jsx'],
    ['apps/*/*.jsx'],
    ['apps/{web,docs}/*.jsx'],
    ['apps/**/view.jsx'],
    ['**/*.jsx', '!apps/web/excluded.jsx'],
    ['**/*.jsx', '!apps/web/excluded.jsx', '**/*.jsx']
  ])('keeps tagged policy overrides inside the owning package: %s', async (...files) => {
    const root = fixture()
    const component = 'export const View = () => <div dangerouslySetInnerHTML={{ __html: "hello" }} />\n'

    write(root, {
      'pawl.config.json': { engine: 'biome', overrides: [{ files, rules: { 'react/no-danger': 'error' } }] },
      'apps/web/view.jsx': component,
      'apps/docs/view.jsx': component,
      'apps/web/excluded.jsx': component
    })
    applyPlan(await planSync(root))
    const result = await check({ root })
    const errors = result.findings.filter(finding => finding.rule === 'react/no-danger' && finding.severity === 'error')

    expect(result.setup).toEqual([])
    expect(errors.some(finding => finding.file === 'apps/web/view.jsx')).toBe(true)
    expect(errors.some(finding => finding.file === 'apps/docs/view.jsx')).toBe(false)
    if (files.includes('!apps/web/excluded.jsx'))
      expect(errors.some(finding => finding.file === 'apps/web/excluded.jsx')).toBe(files.at(-1) === '**/*.jsx')
  })

  it('does not give parent React rules or overrides to nested Vue or plain workspaces', async () => {
    const root = fixture()
    const component = 'export const View = () => <div dangerouslySetInnerHTML={{ __html: "hello" }} />\n'

    write(root, {
      'package.json': { name: 'nested', private: true, workspaces: ['apps/*', 'apps/web/examples/*'] },
      'pawl.config.json': {
        engine: 'biome',
        overrides: [{ files: ['**/*.jsx'], rules: { 'react/no-danger': 'error' } }]
      },
      'apps/web/view.jsx': component,
      'apps/web/examples/vue/package.json': { name: 'vue', dependencies: { vue: '^3.5.0' } },
      'apps/web/examples/vue/view.jsx': component,
      'apps/web/examples/plain/package.json': { name: 'plain' },
      'apps/web/examples/plain/view.jsx': component
    })
    applyPlan(await planSync(root))
    const result = await check({ root })

    expect(result.setup).toEqual([])
    expect(result.findings.filter(finding => finding.rule === 'react/no-danger').map(finding => finding.file)).toEqual([
      'apps/web/view.jsx'
    ])
  })
  it('projects repeated wildcard paths without duplicate suffix expansion', () => {
    const dir = Array.from({ length: 8 }, () => 'nested').join('/')
    const pattern = '**/*/**/*/**/*/**/*.jsx'
    const projected = packagePatterns([pattern], dir)

    expect(projected.length).toBeLessThanOrEqual(8)
    expect(new Set(projected).size).toBe(projected.length)
    for (const file of [`${dir}/view.jsx`, `${dir}/child/view.jsx`, `${dir}/view.js`, 'other/view.jsx']) {
      expect(projected.some(glob => matchesGlob(file, glob))).toBe(
        file.startsWith(`${dir}/`) && matchesGlob(file, pattern)
      )
    }
  })
  it.each(['apps/web', 'apps/*', '**/web'])(
    'does not expand a directory-only override into descendant files: %s',
    async pattern => {
      const root = fixture()
      const component = 'debugger;\nexport const View = () => <div dangerouslySetInnerHTML={{ __html: "hello" }} />\n'

      write(root, {
        'pawl.config.json': {
          engine: 'biome',
          overrides: [{ files: [pattern], rules: { 'react/no-danger': 'off', 'no-debugger': 'off' } }]
        },
        'apps/web/view.jsx': component
      })
      applyPlan(await planSync(root))
      const result = await check({ root })

      expect(result.setup).toEqual([])
      expect(result.findings).toContainEqual(
        expect.objectContaining({ file: 'apps/web/view.jsx', rule: 'react/no-danger' })
      )
      expect(result.findings).toContainEqual(
        expect.objectContaining({ file: 'apps/web/view.jsx', rule: 'no-debugger' })
      )
    }
  )
})
