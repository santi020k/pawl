import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { check } from '../src/check/check.ts'
import { biomeConfig, biomeProjectConfig } from '../src/engines/biome/config.ts'
import { biomeVcs } from '../src/engines/biome/state.ts'
import { eslintPlan } from '../src/engines/eslint/plan.ts'
import { oxlintConfig } from '../src/engines/oxlint/config.ts'
import { defaultPolicy, mergeLayers } from '../src/policy/merge.ts'
import {
  allIgnores,
  configIgnores,
  DEFAULT_IGNORES,
  fromGitignoreLine,
  ignoreMatcher,
  literalBrackets,
  makeIgnore,
  toBiomeIgnore,
  toEslintIgnores
} from '../src/project/ignores.ts'
import { applyInit, planInit } from '../src/setup/init.ts'
import { link, PACKAGE_ROOT, project, write } from './helpers.ts'

const policyWith = (input: Parameters<typeof mergeLayers>[0][number]['input']) =>
  mergeLayers([{ source: 'repo', input }])

describe('.gitignore lines', () => {
  it('match at any depth without a slash, and from the root with one', () => {
    expect(fromGitignoreLine('dist')).toBe('**/dist')
    expect(fromGitignoreLine('dist/')).toBe('**/dist')
    expect(fromGitignoreLine('/dist')).toBe('/dist')
    expect(fromGitignoreLine('/dist/')).toBe('/dist')
    expect(fromGitignoreLine('/src/out')).toBe('src/out')
    expect(fromGitignoreLine('src/out/')).toBe('src/out')
    expect(fromGitignoreLine('*.log')).toBe('**/*.log')
    expect(fromGitignoreLine('!keep.log')).toBe('!**/keep.log')
    expect(fromGitignoreLine('\\#file')).toBe('**/#file')
  })

  it('skip blank lines and comments', () => {
    expect(fromGitignoreLine('')).toBeUndefined()
    expect(fromGitignoreLine('   ')).toBeUndefined()
    expect(fromGitignoreLine('# build output')).toBeUndefined()
  })

  it('keep a name with a leading slash at the root', () => {
    const ignored = makeIgnore(['/build', '!/keep'].map(line => fromGitignoreLine(line) as string))

    expect(ignored('build/out.js')).toBe(true)
    expect(ignored('build')).toBe(true)
    // "/build" is the folder at the root only. A page or a package of that name is still checked.
    expect(ignored('src/build/page.ts')).toBe(false)
    expect(toEslintIgnores('/build')).toEqual(['build', 'build/**'])
  })

  it('read a character class, and a backslash as the next character itself', () => {
    const ignored = makeIgnore(
      ['*.py[cod]', '[Bb]in/', 'v[0-9]', '[!a-c]x', 'notes\\[1\\].md', 'lone[.md'].map(
        line => fromGitignoreLine(line) as string
      )
    )

    for (const file of ['a.pyc', 'src/a.pyd', 'Bin/tool', 'pkg/bin/tool', 'v2/a.js', 'dx', 'notes[1].md', 'lone[.md']) {
      expect(ignored(file), file).toBe(true)
    }

    for (const file of ['a.py', 'a.pyx', 'cin/tool', 'vy/a.js', 'ax', 'notes1.md', '/x']) {
      expect(ignored(file), file).toBe(false)
    }
  })

  it('follow the last pattern that matches, so ! re-includes a file', () => {
    const ignored = makeIgnore(['**/*.log', '!**/keep.log'])

    expect(ignored('a/b.log')).toBe(true)
    expect(ignored('a/keep.log')).toBe(false)
    expect(ignored('node_modules/x/keep.log')).toBe(true)
  })
})

describe('the shared ignore list', () => {
  it('holds build output, lockfiles, AI tool folders and generated code', () => {
    const ignored = makeIgnore(DEFAULT_IGNORES)

    for (const file of [
      'dist/a.js',
      'apps/web/.vercel/output.js',
      '.wrangler/state.json',
      'playwright-report/index.html',
      'tsconfig.tsbuildinfo',
      'pnpm-lock.yaml',
      'packages/a/bun.lock',
      '.changeset/brave-cats.md',
      '.claude/settings.json',
      '.cursor/rules/a.md',
      '.aider.chat.history.md',
      'src/__generated__/types.ts',
      'src/routes.gen.ts',
      'src/schema.generated.ts'
    ]) {
      expect(ignored(file), file).toBe(true)
    }

    for (const file of ['src/generated.ts', 'src/a.ts', 'README.md', 'src/generator/index.ts']) {
      expect(ignored(file), file).toBe(false)
    }
  })

  it('is the same list in every engine, and the policy adds to it', () => {
    const policy = policyWith({ ignore: ['vendor'] })
    const biome = biomeConfig(policy) as { files: { includes: string[] } }
    const oxlint = oxlintConfig(policy) as { ignorePatterns: string[] }

    expect(configIgnores(policy)).toEqual(['.pawl', ...DEFAULT_IGNORES, 'vendor'])
    expect(biome.files.includes).toEqual(['**', ...configIgnores(policy).map(toBiomeIgnore)])
    expect(oxlint.ignorePatterns).toContain('**/.vercel')
    expect(oxlint.ignorePatterns.at(-1)).toBe('**/vendor')
    expect(toEslintIgnores('vendor')).toEqual(['**/vendor', '**/vendor/**'])
    expect(toEslintIgnores('generated/**')).toEqual(['generated/**'])
  })

  it('can be turned off, which the project biome.json undoes by naming each folder again', () => {
    const policy = policyWith({ defaultIgnores: false })

    expect(configIgnores(policy)).toEqual(['.pawl'])
    expect(biomeProjectConfig(policy).files).toEqual({ includes: DEFAULT_IGNORES.map(pattern => `**/${pattern}`) })
    expect(biomeProjectConfig(defaultPolicy()).files).toBeUndefined()
  })
})

describe('a folder with brackets in its name, in every engine', { timeout: 60_000 }, () => {
  // The route folders of Next.js, SvelteKit and Astro. "s" would match "[slug]" read as a character class.
  const files = {
    'src/app/[slug]/page.js': 'debugger\n',
    'src/app/(group)/page.js': 'debugger\n',
    'src/app/s/page.js': 'debugger\n',
    'src/pages/[id].js': 'debugger\n',
    'src/pages/i.js': 'debugger\n',
    'src/app/[slug]/notes.md': '[empty]()\n'
  }
  const policy = {
    ignore: ['src/app/[slug]'],
    overrides: [{ files: ['src/pages/[id].js', 'src/app/(group)/**'], rules: { 'no-debugger': 'off' as const } }]
  }
  // The Markdown file in the ignored folder has an empty link, which pawl's own check would report.
  const expected = ['src/app/s/page.js no-debugger', 'src/pages/i.js no-debugger']
  const flagged = (result: Awaited<ReturnType<typeof check>>): string[] =>
    result.findings
      .filter(finding => finding.rule === 'no-debugger' || finding.engine === 'pawl')
      .map(finding => `${finding.file} ${finding.rule}`)
      .sort()

  it('is named as it is in a policy, and escaped for every reader', () => {
    const merged = policyWith(policy)

    expect(literalBrackets('src/app/[slug]')).toBe('src/app/\\[slug\\]')
    expect(literalBrackets('src/app/\\[slug\\]')).toBe('src/app/\\[slug\\]')
    expect(merged.ignore).toEqual(['src/app/\\[slug\\]'])
    expect(merged.overrides[0]?.files).toEqual(['src/pages/\\[id\\].js', 'src/app/(group)/**'])

    const ignored = makeIgnore(merged.ignore)

    expect(ignored('src/app/[slug]/page.js')).toBe(true)
    expect(ignored('src/app/s/page.js')).toBe(false)
  })

  it('is skipped and overridden by the real Biome', async () => {
    const root = project({ 'package.json': { name: 'fixture', private: true, type: 'module' }, ...files })

    write(root, { 'pawl.config.json': policy })
    link(root)
    applyInit(await planInit({ root, install: false, editor: false }))

    const result = await check({ root })

    // Biome refuses a config with a character class in a glob, so an unescaped bracket would stop the run.
    expect(result.setup).toEqual([])
    expect(flagged(result)).toEqual(expected)
  })

  it.runIf(existsSync(join(PACKAGE_ROOT, 'dist/index.js')))(
    'is skipped and overridden by the real ESLint',
    async () => {
      const root = project({
        'package.json': { name: 'fixture', private: true, type: 'module' },
        'pawl.config.json': { engine: 'eslint', formatter: 'prettier', ...policy },
        'eslint.config.js':
          "import { eslint } from '@santi020k/pawl'\n\nexport default eslint({ root: import.meta.dirname })\n",
        '.prettierrc.json': '{}\n',
        ...files
      })

      link(root, { eslint: true, prettier: true })

      const result = await check({ root })

      expect(result.setup.filter(issue => issue.code === 'engine-failed')).toEqual([])
      expect(flagged(result)).toEqual(expected)
    }
  )

  it('is skipped and overridden by the real Oxlint', async () => {
    const root = project({
      'package.json': { name: 'fixture', private: true, type: 'module' },
      'pawl.config.json': { engine: 'oxlint', ...policy },
      ...files
    })

    link(root)
    applyInit(await planInit({ root, engine: 'oxlint', install: false, editor: false }))

    const result = await check({ root })

    expect(result.setup).toEqual([])
    expect(flagged(result)).toEqual(expected)
  })
})

describe('.gitignore in every engine', { timeout: 60_000 }, () => {
  const files = {
    '.gitignore': '# output\nout/\nlogs-*.js\n!logs-keep.js\n',
    'src/a.js': 'debugger\n',
    'out/b.js': 'debugger\n',
    'logs-a.js': 'debugger\n',
    'logs-keep.js': 'debugger\n'
  }
  const flagged = (result: Awaited<ReturnType<typeof check>>): string[] =>
    [...new Set(result.findings.filter(finding => finding.rule === 'no-debugger').map(finding => finding.file))].sort()

  it('is read into the patterns of pawl and ESLint, unless the policy says not to', async () => {
    const root = project(files)

    expect(allIgnores(root, defaultPolicy()).slice(-3)).toEqual(['**/out', '**/logs-*.js', '!**/logs-keep.js'])
    expect(ignoreMatcher(root, defaultPolicy())('out/b.js')).toBe(true)
    expect(ignoreMatcher(root, defaultPolicy())('logs-keep.js')).toBe(false)
    expect(allIgnores(root, policyWith({ gitignore: false }))).not.toContain('**/out')

    const plan = await eslintPlan({ root, policy: defaultPolicy(), biomeActive: true, typescript: false })
    const ignores = plan.config.find(entry => entry.name === 'pawl/ignores')?.ignores

    expect(ignores).toEqual(expect.arrayContaining(['**/out', '**/out/**', '**/logs-*.js', '!**/logs-keep.js']))
  })

  it('is followed by the real Biome, through its own git integration', async () => {
    const root = project({ 'package.json': { name: 'fixture', private: true, type: 'module' }, ...files })

    link(root)
    applyInit(await planInit({ root, install: false, editor: false }))

    expect(JSON.parse(readFileSync(join(root, 'biome.json'), 'utf8'))).toMatchObject({
      vcs: { enabled: true, clientKind: 'git', useIgnoreFile: true }
    })
    expect(flagged(await check({ root }))).toEqual(['logs-keep.js', 'src/a.js'])

    // Without a .gitignore or a git repo, Biome would refuse the setting, so pawl leaves it out.
    expect(biomeVcs(project({ 'package.json': { name: 'fixture' } }), defaultPolicy())).toBe(false)
    expect(biomeVcs(root, policyWith({ gitignore: false }))).toBe(false)

    // Opting out lints what git ignores.
    write(root, { 'pawl.config.json': { gitignore: false } })
    applyInit(await planInit({ root, install: false, editor: false }))

    const all = await check({ root })

    expect(JSON.parse(readFileSync(join(root, 'biome.json'), 'utf8')).vcs).toMatchObject({ useIgnoreFile: false })
    expect(flagged(all)).toEqual(['logs-a.js', 'logs-keep.js', 'out/b.js', 'src/a.js'])
  })

  it.runIf(existsSync(join(PACKAGE_ROOT, 'dist/index.js')))('is followed by the real ESLint', async () => {
    const root = project({
      'package.json': { name: 'fixture', private: true, type: 'module' },
      'pawl.config.json': { engine: 'eslint', formatter: 'prettier' },
      'eslint.config.js':
        "import { eslint } from '@santi020k/pawl'\n\nexport default eslint({ root: import.meta.dirname })\n",
      '.prettierrc.json': '{}\n',
      ...files
    })

    link(root, { eslint: true, prettier: true })

    const result = await check({ root })

    expect(result.setup.filter(issue => issue.code === 'engine-failed')).toEqual([])
    expect(flagged(result)).toEqual(['logs-keep.js', 'src/a.js'])
  })

  it('is followed by the real Oxlint, which reads it itself', async () => {
    const root = project({
      'package.json': { name: 'fixture', private: true, type: 'module' },
      'pawl.config.json': { engine: 'oxlint' },
      ...files
    })

    link(root)
    applyInit(await planInit({ root, engine: 'oxlint', install: false, editor: false }))

    const result = await check({ root })

    expect(result.setup).toEqual([])
    expect(flagged(result)).toEqual(['logs-keep.js', 'src/a.js'])
  })
})
