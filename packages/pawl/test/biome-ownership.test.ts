import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { check } from '../src/check/check.ts'
import { BIOME_OWNERSHIP_FILE } from '../src/engines/biome/ownership.ts'
import { applyPlan } from '../src/setup/plan.ts'
import { planSync } from '../src/setup/sync.ts'
import { link, PACKAGE_ROOT, project, write } from './helpers.ts'

const policy = (files: string[]) => ({
  engine: 'biome',
  overrides: [{ files, rules: { 'no-debugger': 'off' } }]
})

const fixture = async (): Promise<string> => {
  const root = project({
    'package.json': { name: 'owned-scopes' },
    'pawl.config.json': policy(['old.js']),
    'old.js': 'debugger;\n',
    'new.js': 'debugger;\n'
  })

  link(root)
  applyPlan(await planSync(root))

  return root
}

const contents = (root: string, file: string): string => readFileSync(join(root, file), 'utf8')

const debuggerFiles = async (root: string): Promise<string[]> => {
  const result = await check({ root })

  expect(result.setup).toEqual([])

  return result.findings.filter(finding => finding.rule === 'no-debugger').map(finding => finding.file)
}

describe('generated Biome override ownership', () => {
  it('shows a CLI sync dry-run without writing the config, metadata or backup', async () => {
    const root = await fixture()
    const before = contents(root, 'biome.json')
    const metadata = contents(root, BIOME_OWNERSHIP_FILE)

    write(root, { 'pawl.config.json': policy(['new.js']) })
    const result = spawnSync(process.execPath, [join(PACKAGE_ROOT, 'src/cli.ts'), 'sync', '--dry-run'], {
      cwd: root,
      encoding: 'utf8'
    })

    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('.pawl/backups/')
    expect(result.stdout).toContain(BIOME_OWNERSHIP_FILE)
    expect(contents(root, 'biome.json')).toBe(before)
    expect(contents(root, BIOME_OWNERSHIP_FILE)).toBe(metadata)
    expect(readdirSync(join(root, '.pawl'))).toEqual(['biome-overrides.json'])
  })

  it('updates verified generated scopes, preserves a recoverable backup and converges', async () => {
    const root = await fixture()
    const before = contents(root, 'biome.json')

    expect(await debuggerFiles(root)).toEqual(['new.js'])
    write(root, { 'pawl.config.json': policy(['new.js']) })
    const plan = await planSync(root)

    expect(contents(root, 'biome.json')).toBe(before)
    expect(plan.actions.map(action => action.path)).toContain(BIOME_OWNERSHIP_FILE)
    expect(plan.actions.some(action => action.path.startsWith('.pawl/backups/'))).toBe(true)
    applyPlan(plan)
    expect(await debuggerFiles(root)).toEqual(['old.js'])
    const backups = readdirSync(join(root, '.pawl/backups'))

    expect(backups).toHaveLength(1)
    expect(contents(root, `.pawl/backups/${backups[0]}`)).toBe(before)
    expect((await planSync(root)).actions).toEqual([])
  })

  it.each(['missing', 'corrupt', 'edited'] as const)('preserves %s ownership conflicts byte for byte', async mode => {
    const root = await fixture()

    if (mode === 'missing') rmSync(join(root, BIOME_OWNERSHIP_FILE))
    if (mode === 'corrupt') write(root, { [BIOME_OWNERSHIP_FILE]: '{broken' })
    if (mode === 'edited') {
      const current = contents(root, 'biome.json').replace('old.js', 'custom.js')

      write(root, { 'biome.json': current })
    }

    const before = contents(root, 'biome.json')

    write(root, { 'pawl.config.json': policy(['new.js']) })
    const plan = await planSync(root)

    expect(plan.actions).toEqual([])
    expect(plan.notes.join(' ')).toContain('ownership cannot be established')
    applyPlan(plan)
    expect(contents(root, 'biome.json')).toBe(before)
    expect((await check({ root })).setup).toContainEqual(expect.objectContaining({ code: 'biome-overrides-conflict' }))
  })

  it('never adopts an unknown matching-looking array just because it is current', async () => {
    const root = await fixture()

    rmSync(join(root, BIOME_OWNERSHIP_FILE))
    expect((await planSync(root)).actions).toEqual([])
    write(root, { 'pawl.config.json': policy(['new.js']) })
    expect((await planSync(root)).actions).toEqual([])
  })

  it('removes obsolete generated scopes when the policy no longer has them', async () => {
    const root = await fixture()

    write(root, { 'pawl.config.json': { engine: 'biome' } })
    applyPlan(await planSync(root))
    expect(await debuggerFiles(root)).toEqual(['new.js', 'old.js'])
    expect((await planSync(root)).actions).toEqual([])
  })

  it('refuses a stale plan without overwriting intervening edits', async () => {
    const root = await fixture()

    write(root, { 'pawl.config.json': policy(['new.js']) })
    const plan = await planSync(root)
    const changed = `${contents(root, 'biome.json')}\n`

    write(root, { 'biome.json': changed })
    expect(() => applyPlan(plan)).toThrow('changed after planning')
    expect(contents(root, 'biome.json')).toBe(changed)
  })

  it('does not overwrite an existing backup with different bytes', async () => {
    const root = await fixture()

    write(root, { 'pawl.config.json': policy(['new.js']) })
    const plan = await planSync(root)
    const backup = plan.actions.find(action => action.path.startsWith('.pawl/backups/'))

    expect(backup).toBeDefined()
    if (!backup) throw new Error('Expected backup action')

    write(root, { [backup.path]: 'existing backup\n' })
    const before = contents(root, 'biome.json')

    expect(() => applyPlan(plan)).toThrow('differs from the expected backup')
    expect(contents(root, 'biome.json')).toBe(before)
    expect(contents(root, backup.path)).toBe('existing backup\n')
  })

  it.each(['metadata', 'directory'] as const)(
    'refuses a fresh %s symlink before creating configuration',
    async target => {
      const external = project({ 'user.json': 'unrelated user content\n' })
      const root = project({ 'package.json': { name: 'fresh' }, 'pawl.config.json': policy(['old.js']) })

      link(root)
      if (target === 'directory') symlinkSync(external, join(root, '.pawl'))
      else {
        mkdirSync(join(root, '.pawl'))
        symlinkSync(join(external, 'user.json'), join(root, BIOME_OWNERSHIP_FILE))
      }

      await expect(planSync(root)).rejects.toThrow('is not a plain')
      expect(existsSync(join(root, 'biome.json'))).toBe(false)
      expect(contents(external, 'user.json')).toBe('unrelated user content\n')
      expect(readdirSync(external)).toEqual(['user.json'])
    }
  )

  it('preserves an unknown preexisting metadata file before any configuration write', async () => {
    const root = project({
      'package.json': { name: 'fresh' },
      'pawl.config.json': policy(['old.js']),
      [BIOME_OWNERSHIP_FILE]: 'unrelated metadata\n'
    })

    link(root)
    await expect(planSync(root)).rejects.toThrow('not verified ownership metadata')
    expect(existsSync(join(root, 'biome.json'))).toBe(false)
    expect(contents(root, BIOME_OWNERSHIP_FILE)).toBe('unrelated metadata\n')
    expect(readdirSync(join(root, '.pawl'))).toEqual(['biome-overrides.json'])
  })

  it.each(['before', 'after'] as const)('refuses a backup directory symlink installed %s planning', async when => {
    const root = await fixture()
    const external = project({ 'user.json': 'untouched\n' })
    const before = contents(root, 'biome.json')
    const metadata = contents(root, BIOME_OWNERSHIP_FILE)

    write(root, { 'pawl.config.json': policy(['new.js']) })
    if (when === 'before') {
      symlinkSync(external, join(root, '.pawl/backups'))
      await expect(planSync(root)).rejects.toThrow('is not a plain directory')
    } else {
      const plan = await planSync(root)

      symlinkSync(external, join(root, '.pawl/backups'))
      expect(() => applyPlan(plan)).toThrow('is not a plain directory')
    }

    expect(contents(root, 'biome.json')).toBe(before)
    expect(contents(root, BIOME_OWNERSHIP_FILE)).toBe(metadata)
    expect(readdirSync(external)).toEqual(['user.json'])
    expect(contents(external, 'user.json')).toBe('untouched\n')
  })

  it('refuses metadata path replacement after planning before writing the backup or configuration', async () => {
    const root = await fixture()
    const external = project({ 'user.json': 'untouched\n' })
    const before = contents(root, 'biome.json')

    write(root, { 'pawl.config.json': policy(['new.js']) })
    const plan = await planSync(root)

    rmSync(join(root, BIOME_OWNERSHIP_FILE))
    symlinkSync(join(external, 'user.json'), join(root, BIOME_OWNERSHIP_FILE))
    expect(() => applyPlan(plan)).toThrow('is not a plain file')
    expect(contents(root, 'biome.json')).toBe(before)
    expect(contents(external, 'user.json')).toBe('untouched\n')
    expect(existsSync(join(root, '.pawl/backups'))).toBe(false)
  })

  it('refuses a regular metadata replacement after planning before any writes', async () => {
    const root = await fixture()
    const before = contents(root, 'biome.json')

    write(root, { 'pawl.config.json': policy(['new.js']) })
    const plan = await planSync(root)

    write(root, { [BIOME_OWNERSHIP_FILE]: 'replacement content\n' })
    expect(() => applyPlan(plan)).toThrow('changed after planning')
    expect(contents(root, 'biome.json')).toBe(before)
    expect(contents(root, BIOME_OWNERSHIP_FILE)).toBe('replacement content\n')
    expect(existsSync(join(root, '.pawl/backups'))).toBe(false)
  })

  it.each(['config', 'backup'] as const)('refuses a %s destination symlink installed after planning', async target => {
    const root = await fixture()
    const before = contents(root, 'biome.json')
    const metadata = contents(root, BIOME_OWNERSHIP_FILE)
    const external = project({ 'user.json': before })

    write(root, { 'pawl.config.json': policy(['new.js']) })
    const plan = await planSync(root)

    if (target === 'config') {
      rmSync(join(root, 'biome.json'))
      symlinkSync(join(external, 'user.json'), join(root, 'biome.json'))
    } else {
      const backup = plan.actions.find(action => action.path.startsWith('.pawl/backups/'))

      if (!backup) throw new Error('Expected backup action')
      mkdirSync(join(root, '.pawl/backups'))
      symlinkSync(join(external, 'user.json'), join(root, backup.path))
    }

    expect(() => applyPlan(plan)).toThrow('is not a plain file')
    expect(contents(root, 'biome.json')).toBe(before)
    expect(contents(root, BIOME_OWNERSHIP_FILE)).toBe(metadata)
    expect(contents(external, 'user.json')).toBe(before)
  })
})

describe('the linter and formatter pawl switched off in biome.json', () => {
  it('switches them on again, and reports a biome.json that still has them off', async () => {
    // Oxlint lints, so pawl writes biome.json with Biome's linter off.
    const root = project({
      'package.json': { name: 'back-to-biome' },
      'pawl.config.json': { engine: 'oxlint' },
      'a.js': 'debugger;\n'
    })
    const biome = (): Record<string, unknown> => JSON.parse(contents(root, 'biome.json')) as Record<string, unknown>

    link(root)
    applyPlan(await planSync(root))
    expect(biome()).toMatchObject({ linter: { enabled: false } })

    // Back to Biome: the check must lint again, and say so until biome.json is synced.
    write(root, { 'pawl.config.json': {} })
    expect((await check({ root })).setup).toEqual([expect.objectContaining({ code: 'biome-config-stale' })])

    applyPlan(await planSync(root))
    expect(biome()).not.toHaveProperty('linter.enabled')
    expect(await debuggerFiles(root)).toEqual(['a.js'])

    // Prettier formats, so pawl writes biome.json with Biome's formatter off, then Biome formats again.
    write(root, { 'pawl.config.json': { formatter: 'prettier' } })
    applyPlan(await planSync(root))
    expect(biome()).toMatchObject({ formatter: { enabled: false } })

    write(root, { 'pawl.config.json': {}, 'b.js': 'export const b   =  1\n' })
    expect((await check({ root })).setup).toEqual([expect.objectContaining({ code: 'biome-config-stale' })])

    applyPlan(await planSync(root))
    expect(biome()).not.toHaveProperty('formatter.enabled')
    expect((await check({ root })).findings).toContainEqual(
      expect.objectContaining({ file: 'b.js', rule: 'pawl/format' })
    )
    expect((await planSync(root)).actions).toEqual([])
  })
})
