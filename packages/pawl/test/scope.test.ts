import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { check } from '../src/check.ts'
import { projectPath } from '../src/fs-utils.ts'
import { link, project, write } from './helpers.ts'

/** A disable comment for a fixture, written so that pawl's check of this file does not count it. */
const disable = (text: string): string => `// ${text}`

const LEGACY = `var legacy: any = 1
${disable('eslint-disable-next-line eqeqeq')}
export const same = legacy == 2
`

/** A project whose findings are all in the baseline: source, Markdown and a Dockerfile under src. */
const baselined = async (): Promise<string> => {
  const root = project({
    'package.json': { name: 'fixture', private: true, type: 'module' },
    'biome.json': { extends: ['@santi020k/pawl/biome'] },
    'src/old.ts': LEGACY,
    'src/docs/guide.md': '# Guide\n\n[empty]()\n',
    'src/Dockerfile': 'FROM node\nCMD node server.js\n'
  })

  link(root)
  await check({ root, updateBaseline: true })

  return root
}

describe('a path a caller names', () => {
  it('becomes relative to the root, with forward slashes and no leading ./', () => {
    const root = project({ 'src/a.ts': '' })

    expect(projectPath(root, 'src/a.ts')).toBe('src/a.ts')
    expect(projectPath(root, './src/a.ts')).toBe('src/a.ts')
    expect(projectPath(root, 'src/../src/a.ts')).toBe('src/a.ts')
    expect(projectPath(root, join(root, 'src/a.ts'))).toBe('src/a.ts')
    expect(projectPath(root, 'src/')).toBe('src')
  })

  it('is "." for the root and undefined outside it', () => {
    const root = project({ 'src/a.ts': '' })

    expect(projectPath(root, '.')).toBe('.')
    expect(projectPath(root, root)).toBe('.')
    expect(projectPath(root, '..')).toBeUndefined()
    expect(projectPath(root, '../other/a.ts')).toBeUndefined()
    expect(projectPath(root, join(root, '..', 'other.ts'))).toBeUndefined()
  })
})

describe('the files a check is given, with the real Biome', { timeout: 60_000 }, () => {
  it('reads the baseline for a file however it is named', async () => {
    const root = await baselined()
    const plain = await check({ root, files: ['src/old.ts'] })

    expect(plain.findings).toEqual([])
    expect(plain.baselined).toBe(3)

    // "./" as a person types it, and an absolute path as lint-staged passes it.
    for (const file of ['./src/old.ts', join(root, 'src/old.ts')]) {
      const result = await check({ root, files: [file] })

      expect(result.findings).toEqual([])
      expect(result.baselined).toBe(3)
    }
  })

  it("runs pawl's own checks and the ratchet on disable comments for an absolute path", async () => {
    const root = await baselined()

    write(root, {
      'src/old.ts': `${LEGACY}${disable('biome-ignore lint/suspicious/noExplicitAny: later')}\nexport const other: any = 3\n`,
      'src/docs/guide.md': '# Guide\n\n[empty]()\n\n[another]()\n'
    })

    const result = await check({ root, files: [join(root, 'src/old.ts'), join(root, 'src/docs/guide.md')] })

    expect(result.findings.map(finding => `${finding.file} ${finding.rule}`)).toEqual([
      'src/docs/guide.md pawl/markdown-no-empty-links',
      'src/docs/guide.md pawl/markdown-no-empty-links',
      'src/old.ts pawl/no-new-disable',
      'src/old.ts pawl/no-new-disable'
    ])
  })

  it('takes a folder for every file in it', async () => {
    const root = await baselined()
    const folder = await check({ root, files: ['src'] })

    // Three in the source file, one in the Markdown file and three in the Dockerfile.
    expect(folder.findings).toEqual([])
    expect(folder.baselined).toBe(7)

    write(root, { 'src/Dockerfile': 'FROM node\nMAINTAINER someone\nCMD node server.js\n' })

    expect((await check({ root, files: ['./src/'] })).findings.map(finding => finding.rule)).toEqual([
      'pawl/docker-no-maintainer'
    ])
  })

  it('treats the root as every file, and leaves out what is outside it', async () => {
    const root = await baselined()
    const everything = await check({ root, files: ['.'] })

    expect(everything.nothingToCheck).toBe(false)
    expect(everything.baselined).toBe((await check({ root })).baselined)

    const outside = await check({ root, files: ['../elsewhere/a.ts'] })

    expect(outside.nothingToCheck).toBe(true)
    expect(outside.commands).toEqual([])
  })
})
