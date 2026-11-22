import { expect, it, describe as suite } from 'vitest'
import {
  allTechnologies,
  DETECTABLE,
  describe,
  detect,
  filePacks,
  needsEslint,
  packageTechnologies,
  technologies,
  usesReact
} from '../src/detect.ts'
import { mergeLayers } from '../src/policy.ts'
import { project } from './helpers.ts'

suite('detect', () => {
  it('reads a single-package TypeScript React project', () => {
    const root = project({
      'package.json': { dependencies: { react: '^19.0.0' }, devDependencies: { typescript: '^7.0.0' } },
      'package-lock.json': {},
      'eslint.config.js': 'export default []\n',
      '.prettierrc': '{}\n'
    })
    const detection = detect(root)

    expect(detection).toMatchObject({
      packageManager: 'npm',
      typescript: true,
      frameworks: ['react'],
      tools: { eslint: 'eslint.config.js', prettier: '.prettierrc' },
      workspace: { tool: undefined, packages: [], frameworks: {}, dependencies: {} },
      languages: [],
      ignores: []
    })
    expect(usesReact(detection)).toBe(true)
    expect(technologies(detection)).toEqual(['react'])
    expect(packageTechnologies(detection)).toEqual({})
    expect(needsEslint(detection)).toBe(false)
    expect(describe(detection)).toBe('TypeScript, React, npm')
  })

  it('reads a Turborepo with pnpm workspaces and collects frameworks from every package', () => {
    const root = project({
      'package.json': { packageManager: 'pnpm@11.6.0' },
      'pnpm-workspace.yaml': "packages:\n  - 'apps/*'\n  - packages/*   # libraries\n\ncatalog:\n  react: ^19.0.0\n",
      'turbo.json': {},
      'biome.json': {},
      'apps/web/package.json': { dependencies: { vue: '^3.5.0' } },
      'apps/web/tsconfig.json': {},
      'packages/ui/package.json': { peerDependencies: { react: '^19.0.0' } },
      'packages/not-a-package/readme.md': ''
    })
    const detection = detect(root)

    expect(detection.packageManager).toBe('pnpm')
    expect(detection.workspace).toEqual({
      tool: 'turbo',
      packages: ['apps/web', 'packages/ui'],
      frameworks: { 'apps/web': ['vue'], 'packages/ui': ['react'] },
      dependencies: { 'apps/web': ['vue'], 'packages/ui': ['react'] }
    })
    expect(detection.rootDependencies).toEqual([])
    // Nothing but Turborepo is repo-wide here; each package brings its own technology.
    expect(technologies(detection)).toEqual(['turbo'])
    expect(packageTechnologies(detection)).toEqual({ 'apps/web': ['vue'], 'packages/ui': ['react'] })
    expect(allTechnologies(detection)).toEqual(['react', 'vue', 'turbo'])
    expect(detection.typescript).toBe(true)
    expect(detection.frameworks).toEqual(['react', 'vue'])
    expect(detection.tools).toEqual({ biome: 'biome.json' })
    expect(needsEslint(detection)).toBe(true)
    expect(describe(detection)).toBe('TypeScript, React, Vue, Turborepo with 2 packages, pnpm')
  })

  it('reads Nx and package.json workspaces', () => {
    const root = project({
      'package.json': { workspaces: { packages: ['libs/*'] } },
      'yarn.lock': '',
      'nx.json': {},
      'libs/core/package.json': {}
    })
    const detection = detect(root)

    expect(detection.packageManager).toBe('yarn')
    expect(detection.workspace).toEqual({
      tool: 'nx',
      packages: ['libs/core'],
      frameworks: { 'libs/core': [] },
      dependencies: { 'libs/core': [] }
    })
    expect(describe(detection)).toBe('JavaScript, Nx with 1 package, yarn')
  })

  it('copes with a folder that has no package.json', () => {
    const detection = detect(project())

    expect(detection.packageManager).toBeUndefined()
    expect(detection.frameworks).toEqual([])
    expect(detection.git).toBe(false)
  })

  it('recognises more frameworks, and Vite only when no framework runs it', () => {
    const detection = detect(
      project({
        'package.json': {
          dependencies: { hono: '1', lit: '1', '@nestjs/core': '1', preact: '1', vite: '1' },
          devDependencies: { '@react-router/dev': '1', '@tanstack/react-start': '1' }
        }
      })
    )

    expect(detection.frameworks).toEqual(['hono', 'lit', 'nest', 'preact', 'react-router', 'tanstack-start'])
    expect(describe(detection)).toBe('JavaScript, Hono, Lit, NestJS, Preact, React Router, TanStack Start, npm')
    expect(detect(project({ 'package.json': { devDependencies: { vite: '1', react: '1' } } })).frameworks).toEqual([
      'react',
      'vite'
    ])
    expect(detect(project({ 'package.json': { dependencies: { '@remix-run/react': '1' } } })).frameworks).toEqual([
      'react-router'
    ])
  })

  it('finds TypeScript from any of the usual tsconfig files', () => {
    for (const file of ['tsconfig.base.json', 'tsconfig.app.json', 'tsconfig.node.json']) {
      expect(detect(project({ 'package.json': {}, [file]: {} })).typescript, file).toBe(true)
    }

    expect(detect(project({ 'package.json': {}, 'tsconfig.eslint.json': {} })).typescript).toBe(false)
  })

  it('finds Astro from its components when no package declares it', () => {
    const files = detect(project({ 'package.json': {}, 'src/pages/index.astro': '---\n---\n' }))

    expect(files.frameworks).toEqual(['astro'])
    expect(technologies(files)).toEqual(['astro'])

    // In a monorepo whose docs app declares Astro, the components stay that package's.
    const monorepo = detect(
      project({
        'package.json': { workspaces: ['apps/*'] },
        'apps/docs/package.json': { dependencies: { astro: '5' } },
        'apps/docs/src/pages/index.astro': '---\n---\n'
      })
    )

    expect(monorepo.rootFrameworks).toEqual([])
    expect(packageTechnologies(monorepo)).toEqual({ 'apps/docs': ['astro'] })
  })

  it('looks at the files for formats a pack lints, and suggests those packs', () => {
    const detection = detect(
      project({
        'package.json': {},
        'README.md': '# hi\n',
        'pnpm-workspace.yaml': 'packages: []\n',
        '.github/workflows/ci.yml': 'on: push\n',
        '.vscode/settings.jsonc': '{}\n',
        'config/app.toml': 'a = 1\n',
        'src/schema/user.graphql': 'type User { id: ID }\n',
        'cspell.config.yaml': 'words: []\n',
        'node_modules/x/notes.mdx': '# skipped\n'
      })
    )

    expect(detection.formats).toEqual(['graphql', 'markdown', 'toml', 'yaml'])
    expect(detection.tools.cspell).toBe('cspell.config.yaml')
    expect(filePacks(detection)).toEqual(['markdown', 'yaml', 'toml', 'graphql', 'cspell'])
    expect(filePacks(detect(project({ 'package.json': { devDependencies: { jsdoc: '4' } } })))).toEqual(['jsdoc'])
  })

  it('works out where the code runs', () => {
    const runtimes = (files: Record<string, string | object>) => detect(project(files)).runtimes

    expect(runtimes({ 'package.json': {} })).toEqual(['node', 'browser'])
    expect(runtimes({ 'package.json': { dependencies: { react: '19' } } })).toEqual(['node', 'browser'])
    expect(runtimes({ 'package.json': { dependencies: { '@nestjs/core': '11' } } })).toEqual(['node'])
    expect(runtimes({ 'package.json': { devDependencies: { 'bun-types': '1' } } })).toEqual(['node', 'bun'])
    expect(runtimes({ 'package.json': {}, 'bunfig.toml': '' })).toEqual(['node', 'bun'])
    expect(runtimes({ 'deno.json': {} })).toEqual(['deno'])
    expect(runtimes({ 'package.json': {}, 'deno.jsonc': '{}' })).toEqual(['node', 'deno'])
    expect(runtimes({ 'package.json': {}, 'wrangler.toml': 'name = "x"\n' })).toEqual(['node', 'worker'])
    expect(runtimes({ 'package.json': { dependencies: { hono: '4', react: '19', wrangler: '4' } } })).toEqual([
      'node',
      'browser',
      'worker'
    ])
  })

  it('takes the runtimes the policy names, and can be turned off or told to leave a technology out', () => {
    const root = project({
      'package.json': { dependencies: { react: '19', tailwindcss: '4' } },
      'turbo.json': {},
      'README.md': '# hi\n'
    })
    const policy = (input: Parameters<typeof mergeLayers>[0][number]['input']) =>
      mergeLayers([{ source: 'repo', input }])

    expect(detect(root, policy({ runtime: 'bun' })).runtimes).toEqual(['bun'])
    expect(detect(root, policy({ runtime: ['node', 'worker'] })).runtimes).toEqual(['node', 'worker'])

    const off = detect(root, policy({ detect: false }))

    expect(off.frameworks).toEqual([])
    expect(off.formats).toEqual([])
    expect(off.runtimes).toEqual(['node', 'browser'])
    expect(allTechnologies(off)).toEqual([])
    expect(off.excluded).toEqual(DETECTABLE)
    // The dependencies stay: packs and guards follow what the project installs.
    expect(off.dependencies).toEqual(['react', 'tailwindcss'])

    const some = detect(root, policy({ detect: { exclude: ['tailwind', 'turbo'] } }))

    expect(some.frameworks).toEqual(['react'])
    expect(allTechnologies(some)).toEqual(['react'])
  })
})
