import { describe, expect, it } from 'vitest'
import { PACKS } from '../src/catalog/packs.ts'
import { installedVersion, satisfies } from '../src/utils/semver.ts'
import { PEER_RANGES } from '../src/version.ts'
import { project } from './helpers.ts'

describe('satisfies', () => {
  it('reads the ranges peer dependencies and engines use', () => {
    const cases: [string, string, boolean][] = [
      ['2.6.8', '2.6.8', true],
      ['2.6.9', '2.6.8', false],
      ['22.18.0', '>=22.18.0', true],
      ['22.17.1', '>=22.18.0', false],
      ['24.0.0', '>=22.18.0', true],
      ['9.22.0', '>=9.22.0', true],
      ['3.4.1', '^3.0.0', true],
      ['4.0.0', '^3.0.0', false],
      ['0.2.9', '^0.2.3', true],
      ['0.3.0', '^0.2.3', false],
      ['0.0.4', '^0.0.3', false],
      ['1.2.9', '~1.2.3', true],
      ['1.3.0', '~1.2.3', false],
      ['5.0.0', '*', true],
      ['8.1.0', '8.x', true],
      ['9.0.0', '8.x', false],
      ['1.5.0', '>=1.0.0 <2.0.0', true],
      ['2.0.0', '>=1.0.0 <2.0.0', false],
      ['10.1.0', '^9.0.0 || ^10.0.0', true],
      ['1.5.0', '1.0.0 - 2.0.0', true],
      ['3.0.0-beta.1', '^2.0.0', false],
      ['2.1.0-rc.1', '>=2.0.0', true],
      ['not-a-version', '*', false],
      ['1.0.0', 'latest', false]
    ]

    for (const [version, range, expected] of cases)
      expect(satisfies(version, range), `${version} in ${range}`).toBe(expected)
  })
})

describe('installedVersion', () => {
  it('finds the nearest node_modules that has the package, without loading it', () => {
    const root = project({
      'node_modules/eslint/package.json': { name: 'eslint', version: '10.1.0' },
      'packages/app/package.json': { name: 'app' }
    })

    expect(installedVersion(`${root}/packages/app`, 'eslint')).toBe('10.1.0')
    expect(installedVersion(root, 'prettier')).toBeUndefined()
  })
})

describe('the plugin ranges', () => {
  it('give every pack the range its plugin has as a peer, and a real floor', () => {
    for (const pack of PACKS) {
      if (pack.plugin === 'eslint') continue

      expect(PEER_RANGES[pack.plugin], pack.plugin).toBe(pack.range)
      expect(pack.range, pack.plugin).not.toBe('*')
      expect(pack.range, pack.plugin).toMatch(/^>=\d+\.\d+\.\d+$/)
    }
  })
})
