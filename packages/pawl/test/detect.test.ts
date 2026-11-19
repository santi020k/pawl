import { expect, it, describe as suite } from 'vitest'
import {
  allTechnologies,
  describe,
  detect,
  needsEslint,
  packageTechnologies,
  technologies,
  usesReact
} from '../src/detect.ts'
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
      workspace: { tool: undefined, packages: [], frameworks: {} }
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
      frameworks: { 'apps/web': ['vue'], 'packages/ui': ['react'] }
    })
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
    expect(detection.workspace).toEqual({ tool: 'nx', packages: ['libs/core'], frameworks: { 'libs/core': [] } })
    expect(describe(detection)).toBe('JavaScript, Nx with 1 package, yarn')
  })

  it('copes with a folder that has no package.json', () => {
    const detection = detect(project())

    expect(detection.packageManager).toBeUndefined()
    expect(detection.frameworks).toEqual([])
    expect(detection.git).toBe(false)
  })
})
