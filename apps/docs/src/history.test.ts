import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

import { compareVersions, parseChangelog, parseChangeset, pendingRelease, readHistory } from './history.ts'

const changelog = `# @santi020k/pawl

## 0.2.0

### Minor Changes

- [#12](https://github.com/santi020k/pawl/pull/12) A new pack.

### Patch Changes

- A fix.

  \`\`\`sh
  ## not a heading
  \`\`\`

## 0.1.0

### Minor Changes

- First public release.
`

describe('parseChangelog', () => {
  it('reads the package name, each version and its groups', () => {
    const parsed = parseChangelog(changelog)

    assert.equal(parsed.name, '@santi020k/pawl')
    assert.deepEqual([...parsed.versions.keys()], ['0.2.0', '0.1.0'])
    assert.deepEqual(
      parsed.versions.get('0.2.0')?.map(group => group.kind),
      ['Minor Changes', 'Patch Changes']
    )
    assert.deepEqual(parsed.versions.get('0.1.0'), [{ kind: 'Minor Changes', markdown: '- First public release.' }])
  })

  it('does not split on a heading inside a code fence', () => {
    const patch = parseChangelog(changelog).versions.get('0.2.0')?.[1]?.markdown ?? ''

    assert.match(patch, /## not a heading/)
  })
})

describe('parseChangeset', () => {
  it('reads the bumps and the summary', () => {
    const parsed = parseChangeset(
      '---\n"@santi020k/pawl": minor\n\'@santi020k/pawl-policy\': patch\n---\n\nAdds a pack.\n'
    )

    assert.deepEqual(parsed, {
      bumps: [
        { name: '@santi020k/pawl', bump: 'minor' },
        { name: '@santi020k/pawl-policy', bump: 'patch' }
      ],
      summary: 'Adds a pack.'
    })
  })

  it('skips an empty changeset and a file without front matter', () => {
    assert.equal(parseChangeset('---\n---\n'), undefined)
    assert.equal(parseChangeset('# Changesets\n\nRead the docs.'), undefined)
  })
})

describe('pendingRelease', () => {
  it('groups the changesets by package and bump, in the order given', () => {
    const pending = pendingRelease(
      [
        { bumps: [{ name: 'b', bump: 'patch' }], summary: 'Fixes b.' },
        { bumps: [{ name: 'a', bump: 'minor' }], summary: 'Adds to a.\n\nWith detail.' }
      ],
      ['a', 'b']
    )

    assert.deepEqual(pending, {
      packages: [
        { name: 'a', groups: [{ kind: 'Minor Changes', markdown: '- Adds to a.\n  \n  With detail.' }] },
        { name: 'b', groups: [{ kind: 'Patch Changes', markdown: '- Fixes b.' }] }
      ]
    })
  })

  it('is undefined without changesets', () => {
    assert.equal(pendingRelease([], []), undefined)
  })
})

describe('compareVersions', () => {
  it('sorts newest first, with a prerelease before its release', () => {
    assert.deepEqual(['0.1.0', '0.10.0', '0.2.0-next.1', '0.2.0', '1.0.0'].sort(compareVersions), [
      '1.0.0',
      '0.10.0',
      '0.2.0',
      '0.2.0-next.1',
      '0.1.0'
    ])
  })
})

describe('readHistory', () => {
  it('puts the pending changes first and dates the tagged versions', () => {
    const root = mkdtempSync(join(tmpdir(), 'pawl-history-'))

    try {
      mkdirSync(join(root, 'packages', 'pawl'), { recursive: true })
      mkdirSync(join(root, 'packages', 'pawl-policy'), { recursive: true })
      mkdirSync(join(root, '.changeset'))
      writeFileSync(join(root, 'packages', 'pawl', 'CHANGELOG.md'), changelog)
      writeFileSync(
        join(root, 'packages', 'pawl-policy', 'CHANGELOG.md'),
        '# @santi020k/pawl-policy\n\n## 0.1.0\n\n### Minor Changes\n\n- First release.\n'
      )
      writeFileSync(join(root, '.changeset', 'config.json'), '{}')
      writeFileSync(join(root, '.changeset', 'README.md'), '# Changesets\n')
      writeFileSync(join(root, '.changeset', 'new-pack.md'), '---\n"@santi020k/pawl": minor\n---\n\nAnother pack.\n')

      const history = readHistory(root, version => (version === '0.1.0' ? '2026-11-20T17:31:29Z' : undefined))

      assert.deepEqual(
        history.map(release => [release.version, release.date, release.packages.map(notes => notes.name)]),
        [
          [undefined, undefined, ['@santi020k/pawl']],
          ['0.2.0', undefined, ['@santi020k/pawl']],
          ['0.1.0', '2026-11-20T17:31:29Z', ['@santi020k/pawl', '@santi020k/pawl-policy']]
        ]
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
