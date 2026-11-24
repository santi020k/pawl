import { execFile } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearSession, editedFiles, readStopState, recordEdits, writeStopState } from '../src/cli/hook-state.ts'

const roots: string[] = []
const fixture = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'pawl-hook-safe-'))

  roots.push(root)

  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const state = { rounds: 1, signature: 'original' }
const execute = promisify(execFile)

describe('private hook state', () => {
  it('keeps every first append when edit hooks start together', async () => {
    const dir = join(fixture(), 'state')
    const module = new URL('../src/cli/hook-state.ts', import.meta.url).href
    const script = `import { recordEdits } from ${JSON.stringify(module)};
recordEdits('/repo', 'session', [process.argv[2]], process.argv[1]);`
    const files = Array.from({ length: 8 }, (_, index) => `src/file-${index}.ts`)

    await Promise.all(files.map(file => execute(process.execPath, ['--input-type=module', '-e', script, dir, file])))

    expect(editedFiles('/repo', 'session', dir).sort()).toEqual(files)
  })

  it('creates private files and safely replaces a longer stop state', () => {
    const dir = join(fixture(), 'state')

    recordEdits('/repo', 'session', ['src/a.ts'], dir)
    writeStopState('/repo', 'session', state, dir)
    writeStopState('/repo', 'session', { rounds: 2, signature: 'x' }, dir)

    expect(editedFiles('/repo', 'session', dir)).toEqual(['src/a.ts'])
    expect(readStopState('/repo', 'session', dir)).toEqual({ rounds: 2, signature: 'x' })
    if (process.getuid) {
      expect(lstatSync(dir).mode & 0o077).toBe(0)
      for (const file of readdirSync(dir)) expect(lstatSync(join(dir, file)).mode & 0o077).toBe(0)
    }
  })

  it('refuses a symlink as the state directory', () => {
    const root = fixture()
    const victim = join(root, 'victim')
    const dir = join(root, 'state')

    mkdirSync(victim, { mode: 0o700 })
    symlinkSync(victim, dir, 'junction')
    recordEdits('/repo', 'session', ['src/a.ts'], dir)
    writeStopState('/repo', 'session', state, dir)
    clearSession('/repo', 'session', dir)

    expect(readdirSync(victim)).toEqual([])
    expect(editedFiles('/repo', 'session', dir)).toEqual([])
    expect(readStopState('/repo', 'session', dir)).toBeUndefined()
    expect(lstatSync(dir).isSymbolicLink()).toBe(true)
  })

  it.skipIf(process.getuid === undefined)('refuses public state directories and unsafe parents', () => {
    const root = fixture()
    const dir = join(root, 'state')

    mkdirSync(dir, { mode: 0o700 })
    chmodSync(dir, 0o777)
    recordEdits('/repo', 'session', ['src/a.ts'], dir)
    writeStopState('/repo', 'session', state, dir)

    expect(readdirSync(dir)).toEqual([])
    chmodSync(dir, 0o700)
    chmodSync(root, 0o777)
    recordEdits('/repo', 'session', ['src/a.ts'], dir)
    writeStopState('/repo', 'session', state, dir)
    expect(readdirSync(dir)).toEqual([])
  })

  it.skipIf(process.getuid === undefined)('refuses state owned by another user', () => {
    const dir = join(fixture(), 'state')

    recordEdits('/repo', 'session', ['src/a.ts'], dir)
    writeStopState('/repo', 'session', state, dir)
    const identity = vi.spyOn(process, 'getuid').mockReturnValue((process.getuid?.() ?? 0) + 1)

    try {
      recordEdits('/repo', 'session', ['src/b.ts'], dir)
      writeStopState('/repo', 'session', { rounds: 3, signature: 'changed' }, dir)
      clearSession('/repo', 'session', dir)
      expect(editedFiles('/repo', 'session', dir)).toEqual([])
      expect(readStopState('/repo', 'session', dir)).toBeUndefined()
    } finally {
      identity.mockRestore()
    }

    expect(editedFiles('/repo', 'session', dir)).toEqual(['src/a.ts'])
    expect(readStopState('/repo', 'session', dir)).toEqual(state)
  })

  it('never follows state symlinks or changes hard-linked victims', () => {
    const root = fixture()
    const dir = join(root, 'state')
    const victim = join(root, 'config.json')

    recordEdits('/repo', 'session', ['src/a.ts'], dir)
    writeStopState('/repo', 'session', state, dir)
    const files = readdirSync(dir)

    writeFileSync(victim, 'keep this config', { mode: 0o600 })
    for (const link of [symlinkSync, linkSync]) {
      for (const file of files) {
        const path = join(dir, file)

        rmSync(path)
        link(victim, path)
      }
      recordEdits('/repo', 'session', ['src/b.ts'], dir)
      writeStopState('/repo', 'session', { rounds: 3, signature: 'changed' }, dir)
      expect(editedFiles('/repo', 'session', dir)).toEqual([])
      expect(readStopState('/repo', 'session', dir)).toBeUndefined()
      clearSession('/repo', 'session', dir)
      expect(readFileSync(victim, 'utf8')).toBe('keep this config')
      for (const file of files) expect(existsSync(join(dir, file))).toBe(true)
    }
  })

  it.skipIf(process.getuid === undefined)('leaves existing public state files unchanged', () => {
    const dir = join(fixture(), 'state')

    recordEdits('/repo', 'session', ['src/a.ts'], dir)
    writeStopState('/repo', 'session', state, dir)
    const files = readdirSync(dir).map(file => join(dir, file))
    const contents = files.map(file => readFileSync(file, 'utf8'))

    for (const file of files) chmodSync(file, 0o666)
    recordEdits('/repo', 'session', ['src/b.ts'], dir)
    writeStopState('/repo', 'session', { rounds: 3, signature: 'changed' }, dir)
    clearSession('/repo', 'session', dir)

    expect(editedFiles('/repo', 'session', dir)).toEqual([])
    expect(readStopState('/repo', 'session', dir)).toBeUndefined()
    expect(files.map(file => readFileSync(file, 'utf8'))).toEqual(contents)
  })
})
