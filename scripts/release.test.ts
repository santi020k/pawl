import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  changelogSection,
  contentProblems,
  firstPublishProblem,
  type NpmState,
  npmStateFrom,
  type ReleasePackage,
  releaseBranchVersion,
  releaseNotes,
  type SourceInput,
  sourceProblems,
  versionChanges
} from './release.ts'

const changelog =
  '# @santi020k/pawl\n\n## 1.2.0\n\n### Minor Changes\n\n- A new rule.\n\n## 1.1.0\n\n### Patch Changes\n\n- A fix.\n'

const pkg = (overrides: Partial<ReleasePackage> = {}): ReleasePackage => ({
  name: '@santi020k/pawl',
  version: '1.2.0',
  dir: 'packages/pawl',
  changelog,
  ...overrides
})

const source = (overrides: Partial<SourceInput> = {}): SourceInput => ({
  branch: 'release/v1.2.0',
  packages: [pkg()],
  pendingChangesets: [],
  npmState: (): NpmState => 'unpublished',
  tagExists: () => false,
  ...overrides
})

describe('releaseBranchVersion', () => {
  it('reads the version from a release branch', () => {
    assert.equal(releaseBranchVersion('release/v1.2.0'), '1.2.0')
    assert.equal(releaseBranchVersion('release/v1.2.0-beta.1'), '1.2.0-beta.1')
  })

  it('refuses any other branch name', () => {
    for (const branch of ['main', 'release/1.2.0', 'release/v1.2', 'release/v1.2.0+build', 'feature/release/v1.2.0']) {
      assert.equal(releaseBranchVersion(branch), undefined, branch)
    }
  })
})

describe('changelogSection', () => {
  it('returns one version, without its neighbours', () => {
    assert.equal(changelogSection(changelog, '1.2.0'), '### Minor Changes\n\n- A new rule.')
    assert.equal(changelogSection(changelog, '1.1.0'), '### Patch Changes\n\n- A fix.')
  })

  it('is undefined for a version the changelog does not have', () => {
    assert.equal(changelogSection(changelog, '1.2'), undefined)
    assert.equal(changelogSection('', '1.2.0'), undefined)
  })

  it('is empty for a version Changesets bumped without a change of its own', () => {
    assert.equal(changelogSection('# pkg\n\n## 1.2.0\n\n## 1.1.0\n\n- A fix.\n', '1.2.0'), '')
  })
})

describe('npmStateFrom', () => {
  it('tells a published version from a missing one', () => {
    assert.equal(npmStateFrom(0, '["1.1.0", "1.2.0"]', '', '1.2.0'), 'published')
    assert.equal(npmStateFrom(0, '["1.1.0"]', '', '1.2.0'), 'unpublished')
    assert.equal(npmStateFrom(0, '["1.2.0"]', '', '1.2.0'), 'published')
  })

  it('tells a package npm has never seen', () => {
    assert.equal(npmStateFrom(1, '', 'npm error code E404\nnpm error 404 Not Found', '1.2.0'), 'unknown-package')
    assert.equal(npmStateFrom(1, '{"error":{"code":"E404"}}', '', '1.2.0'), 'unknown-package')
  })

  it('throws on any other failure, so a network error never reads as unpublished', () => {
    assert.throws(() => npmStateFrom(1, '', 'npm error code ENOTFOUND', '1.2.0'), /ENOTFOUND/)
    assert.throws(() => npmStateFrom(null, '', '', '1.2.0'))
    assert.throws(() => npmStateFrom(0, '"1.2.0"', '', '1.2.0'), /did not list the versions/)
  })
})

describe('contentProblems', () => {
  it('accepts a prepared release, even when one package has no change of its own', () => {
    const policy = pkg({ name: '@santi020k/pawl-policy', changelog: '# policy\n\n## 1.2.0\n' })
    assert.deepEqual(contentProblems([pkg(), policy], '1.2.0', []), [])
  })

  it('refuses a commit that carries unreleased work on top of a version', () => {
    assert.match(contentProblems([pkg()], '1.2.0', ['calm-dogs-run.md']).join('\n'), /still pending/)
  })

  it('refuses packages that do not share the version', () => {
    assert.match(contentProblems([pkg({ version: '1.1.0' })], '1.2.0', []).join('\n'), /is at 1\.1\.0/)
  })
})

describe('sourceProblems', () => {
  it('accepts a prepared release branch', () => {
    assert.deepEqual(sourceProblems(source()), [])
  })

  it('accepts the first release of a package npm has never seen', () => {
    assert.deepEqual(sourceProblems(source({ npmState: () => 'unknown-package' })), [])
  })

  it('refuses a branch that is not a release branch', () => {
    assert.match(sourceProblems(source({ branch: 'feature/new-rule' })).join('\n'), /not a release branch/)
  })

  it('refuses a package whose version is not the branch version', () => {
    const problems = sourceProblems(
      source({ packages: [pkg(), pkg({ name: '@santi020k/pawl-policy', version: '1.1.0' })] })
    )
    assert.equal(problems.length, 1)
    assert.match(problems.join('\n'), /pawl-policy is at 1\.1\.0, but the release is 1\.2\.0/)
  })

  it('refuses a missing changelog entry', () => {
    assert.match(sourceProblems(source({ packages: [pkg({ changelog: '' })] })).join('\n'), /no entry for 1\.2\.0/)
  })

  it('refuses pending changesets', () => {
    assert.match(sourceProblems(source({ pendingChangesets: ['calm-dogs-run.md'] })).join('\n'), /calm-dogs-run\.md/)
  })

  it('refuses a version that is already published or tagged', () => {
    assert.match(sourceProblems(source({ npmState: () => 'published' })).join('\n'), /already on npm/)
    assert.match(
      sourceProblems(source({ tagExists: tag => tag === 'v1.2.0' })).join('\n'),
      /tag v1\.2\.0 already exists/
    )
  })

  it('refuses a repository with nothing to publish', () => {
    assert.match(sourceProblems(source({ packages: [] })).join('\n'), /No publishable package/)
  })

  it('reports every problem at once', () => {
    assert.equal(
      sourceProblems(source({ pendingChangesets: ['a.md'], npmState: () => 'published', tagExists: () => true }))
        .length,
      3
    )
  })
})

describe('versionChanges', () => {
  it('accepts unchanged versions and packages the base does not have', () => {
    assert.deepEqual(
      versionChanges([pkg()], () => '1.2.0'),
      []
    )
    assert.deepEqual(
      versionChanges([pkg()], () => undefined),
      []
    )
  })

  it('refuses a version that moved away from the base', () => {
    assert.match(versionChanges([pkg()], () => '1.1.0').join('\n'), /goes from 1\.1\.0 to 1\.2\.0/)
  })
})

describe('firstPublishProblem', () => {
  it('is silent when npm knows every package', () => {
    assert.equal(firstPublishProblem([]), undefined)
  })

  it('names the packages to publish by hand first', () => {
    assert.match(firstPublishProblem(['@santi020k/pawl']) ?? '', /@santi020k\/pawl is not on npm yet/)
    assert.match(firstPublishProblem(['a', 'b']) ?? '', /a and b are not on npm yet/)
  })
})

describe('releaseNotes', () => {
  it('joins each package entry under its own heading', () => {
    const notes = releaseNotes([pkg(), pkg({ name: '@santi020k/pawl-policy', changelog: '' })])
    assert.equal(
      notes,
      '## @santi020k/pawl@1.2.0\n\n### Minor Changes\n\n- A new rule.\n\n## @santi020k/pawl-policy@1.2.0\n\nNo changes recorded.'
    )
  })
})
