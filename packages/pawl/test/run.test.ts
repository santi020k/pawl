import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { check } from '../src/check.ts'
import { chunkFiles, EngineError, FILES_BUDGET, runChunked, runNode } from '../src/engines/run.ts'
import { link, project } from './helpers.ts'

/** File names as a large pull request has them: `count` of them, each in a folder a few levels down. */
const names = (count: number): string[] =>
  Array.from({ length: count }, (_, index) => `src/features/area-${index % 40}/module-${index}.ts`)

describe('a file list too long for one command line', () => {
  it('is split into chunks that each stay under the budget', () => {
    const chunks = chunkFiles(names(5000))

    expect(chunks.length).toBeGreaterThan(1)

    for (const chunk of chunks) {
      expect(chunk.length).toBeGreaterThan(0)
      expect(chunk.join(' ').length).toBeLessThanOrEqual(FILES_BUDGET)
    }

    // A chunk is as full as the budget lets it be: one more name would not have fitted.
    expect(chunks[0]?.join(' ').length).toBeGreaterThan(FILES_BUDGET * 0.8)
  })

  it('keeps every file, once, in the order given', () => {
    const files = names(5000)

    expect(chunkFiles(files).flat()).toEqual(files)
    expect(chunkFiles(['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'], 16)).toEqual([
      ['a.ts', 'b.ts'],
      ['c.ts', 'd.ts'],
      ['e.ts']
    ])
  })

  it('leaves a list that fits as one chunk, and makes none from no files', () => {
    expect(chunkFiles(['src/a.ts', 'src/b.ts'])).toEqual([['src/a.ts', 'src/b.ts']])
    expect(chunkFiles([])).toEqual([])
  })

  it('gives a name longer than the budget a chunk of its own', () => {
    const long = `src/${'deep/'.repeat(10)}file.ts`

    expect(chunkFiles(['a.ts', long, 'b.ts', 'c.ts'], 20)).toEqual([['a.ts'], [long], ['b.ts', 'c.ts']])
    expect(chunkFiles([long, long], 20)).toEqual([[long], [long]])
  })
})

describe('an engine given a list of files', () => {
  it('runs once for each chunk, one after the other, and reports the command once', async () => {
    const files = names(5000)
    const order: string[] = []
    let running = 0

    const { findings, command } = await runChunked(files, 'engine --flag', async targets => {
      expect(running).toBe(0)
      running += 1
      await new Promise(resolve => setTimeout(resolve, 1))
      order.push(...targets)
      running -= 1

      return [targets[0], targets.at(-1)]
    })

    const chunks = chunkFiles(files)

    expect(order).toEqual(files)
    expect(findings).toEqual(chunks.flatMap(chunk => [chunk[0], chunk.at(-1)]))
    expect(command).toBe(`engine --flag (5000 files in ${chunks.length} runs)`)
  })

  it('reports one run with its files, and the whole project as "."', async () => {
    const seen: string[][] = []
    const run = (targets: readonly string[]): Promise<string[]> => {
      seen.push([...targets])

      return Promise.resolve([])
    }

    expect((await runChunked(['src/a.ts', 'src/b.ts'], 'engine', run)).command).toBe('engine src/a.ts src/b.ts')
    expect((await runChunked(undefined, 'engine', run)).command).toBe('engine .')
    expect((await runChunked([], 'engine', run)).command).toBe('engine .')
    expect(seen).toEqual([['src/a.ts', 'src/b.ts'], ['.'], ['.']])
  })

  it('stops at the first run that fails, so a part that did not run is never a clean result', async () => {
    let runs = 0

    const failing = runChunked(names(5000), 'engine', () => {
      runs += 1

      return runs === 2 ? Promise.reject(new EngineError('It broke.', { command: 'engine' })) : Promise.resolve([])
    })

    await expect(failing).rejects.toThrow(EngineError)
    expect(runs).toBe(2)
  })
})

describe('an engine process that cannot start', () => {
  const script = join(import.meta.dirname, 'helpers.ts')

  it('is an engine error when Node reports it after the call', async () => {
    const missing = join(import.meta.dirname, 'no-such-folder')
    const failure = await runNode(script, [], missing, 'engine').catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(EngineError)
    expect((failure as EngineError).message).toMatch(/^The process could not be started: spawn .+ ENOENT$/)
    expect((failure as EngineError).command).toBe('engine')
  })

  it('is an engine error when the command line is too long for the system', async () => {
    // Longer than any system takes: Windows stops near 32,000 characters, Linux and macOS at one or two million.
    const endless = 'x'.repeat(3 * 1024 * 1024)
    const failure = await runNode(script, [endless], import.meta.dirname, 'engine').catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(EngineError)
    expect((failure as EngineError).message).toMatch(/^The process could not be started: spawn /)
  })
})

describe('thousands of files, with the real Biome', { timeout: 60_000 }, () => {
  it('checks them in several runs and reports what is wrong in the first and in the last', async () => {
    const files = Array.from({ length: 3000 }, (_, index) => `src/generated/module-${index}.ts`)
    const broken = [files[0], files[1500], files[2999]] as string[]
    const root = project({
      'package.json': { name: 'fixture', private: true, type: 'module' },
      'biome.json': { extends: ['@santi020k/pawl/biome'] },
      ...Object.fromEntries(files.map(file => [file, 'export const value = 1\n'])),
      ...Object.fromEntries(broken.map(file => [file, 'var value = 1\n\nexport { value }\n']))
    })

    link(root)

    const runs = chunkFiles(files).length
    const result = await check({ root, files })

    expect(runs).toBeGreaterThan(2)
    expect(result.setup).toEqual([])
    expect(result.commands).toEqual([`biome check (3000 files in ${runs} runs)`])
    expect(result.findings.map(finding => `${finding.file} ${finding.rule}`)).toEqual(
      broken.map(file => `${file} no-var`)
    )
  })
})
