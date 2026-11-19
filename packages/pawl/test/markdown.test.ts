import { describe, expect, it } from 'vitest'
import { checkMarkdown, getMarkdownRule, isMarkdownFile, MARKDOWN_RULES } from '../src/markdown.ts'
import { defaultPolicy, mergeLayers } from '../src/policy.ts'
import { type Policy } from '../src/types.ts'
import { project } from './helpers.ts'

const rules = (root: string, policy = defaultPolicy(), files?: readonly string[]): string[] =>
  checkMarkdown(files ? { root, policy, files } : { root, policy }).map(
    finding => `${finding.file}:${finding.line} ${finding.rule.slice('pawl/'.length)}`
  )

const turnOn = (...names: string[]): Policy =>
  mergeLayers([
    { source: 'repo', input: { rules: Object.fromEntries(names.map(name => [`pawl/markdown-${name}`, 'warn'])) } }
  ])

const EMPTY_LINKS = `# Links

An [empty link]() and one with [angle brackets](<>).
A [fragment](#) only.
A [good link](https://example.com), a [section](#links) and an empty image ![alt]().
`

const DUPLICATE_HEADINGS = `# Guide

## Install

Some text.

## Usage

### Install ##

Usage
-----

## Install again
`

const MISSING_REFS = `# References

See [the docs][docs], the [Guide][] and [nowhere].
Also [missing][gone] and an image ![logo][brand].

[Docs]: https://example.com/docs
[guide]: https://example.com/guide
[brand]: ./logo.png
`

const FINE_REFS = `# Fine

- [ ] a task
- [x] a done task

> [!NOTE]
> An alert.

An [inline](https://example.com) link, [![badge](b.svg)](https://example.com), escaped \\[brackets\\],
\`code [spans]\`, a footnote[^1], a wiki link [[Page]], items[0] and a [  Spaced   Label ].

:::note[Title]
A directive.
:::

[^1]: The footnote.
[spaced label]: https://example.com
`

const SKIPPED = `---
title: [front matter]
link: []()
---

# Title

\`\`\`md
# Title
[empty]()
[missing]
\`\`\`

~~~~
[empty]()
~~~
still code
~~~~

<!-- [empty]() and
[missing] -->

\`[empty]()\`
`

describe('Markdown checks', () => {
  it('knows which files to read', () => {
    expect(['README.md', 'docs/Guide.MD', 'notes.markdown'].every(isMarkdownFile)).toBe(true)
    expect(['page.mdx', 'md', 'src/md.ts'].some(isMarkdownFile)).toBe(false)
  })

  it('has unique rule names, each one known', () => {
    const names = MARKDOWN_RULES.map(def => def.name)

    expect(new Set(names).size).toBe(names.length)
    expect(names.every(name => getMarkdownRule(name)?.name === name)).toBe(true)
  })

  it('finds empty links, but not empty images or links that go somewhere', () => {
    const root = project({ 'README.md': EMPTY_LINKS })

    expect(rules(root)).toEqual([
      'README.md:3 markdown-no-empty-links',
      'README.md:3 markdown-no-empty-links',
      'README.md:4 markdown-no-empty-links'
    ])

    const [finding] = checkMarkdown({ root, policy: defaultPolicy() })

    expect(finding).toMatchObject({ column: 4, severity: 'error', engine: 'pawl', fixable: false })
    expect(finding?.message).toBe('A link has no destination. Add the URL the link points to, or remove the link.')
  })

  it('stays quiet on links that are fine', () => {
    expect(rules(project({ 'README.md': '[home](https://example.com) and [top](#top)\n' }))).toEqual([])
  })

  it('finds a heading that repeats an earlier one anywhere in the document, at any level', () => {
    const root = project({ 'guide.md': DUPLICATE_HEADINGS })
    const policy = turnOn('no-duplicate-headings')

    expect(rules(root, policy)).toEqual([
      'guide.md:9 markdown-no-duplicate-headings',
      'guide.md:11 markdown-no-duplicate-headings'
    ])
    expect(checkMarkdown({ root, policy })[0]?.message).toBe(
      'A heading repeats an earlier heading (Install). Give each heading its own text, so its anchor is unique.'
    )
  })

  it('stays quiet on headings that are all different', () => {
    expect(
      rules(
        project({ 'guide.md': '# Guide\n\n## Install\n\n## Usage\n\n---\n\nUsage\n' }),
        turnOn('no-duplicate-headings')
      )
    ).toEqual([])
  })

  it('finds references with no definition, with labels compared as CommonMark does', () => {
    const root = project({ 'refs.md': MISSING_REFS })

    expect(rules(root, turnOn('no-missing-label-refs'))).toEqual([
      'refs.md:3 markdown-no-missing-label-refs',
      'refs.md:4 markdown-no-missing-label-refs'
    ])
    expect(checkMarkdown({ root, policy: turnOn('no-missing-label-refs') }).map(finding => finding.message)).toEqual([
      'A reference has no matching definition (nowhere). Add a definition such as [label]: https://example.com, or escape the brackets.',
      'A reference has no matching definition (gone). Add a definition such as [label]: https://example.com, or escape the brackets.'
    ])
  })

  it('leaves tasks, alerts, inline links, escapes, code spans, footnotes, wiki links and directives alone', () => {
    expect(rules(project({ 'fine.md': FINE_REFS }), turnOn('no-missing-label-refs'))).toEqual([])
  })

  it('skips front matter, fenced code, HTML comments and code spans', () => {
    const root = project({ 'skip.md': SKIPPED })

    expect(rules(root, turnOn('no-duplicate-headings', 'no-missing-label-refs'))).toEqual([])
  })

  it('reports nothing for the rules that are off by default', () => {
    const root = project({ 'guide.md': DUPLICATE_HEADINGS, 'refs.md': MISSING_REFS })

    expect(rules(root)).toEqual([])
  })

  it('honours the policy: a rule turned off, ignored files and the files option', () => {
    const root = project({
      'README.md': EMPTY_LINKS,
      'docs/a.md': '[x]()\n',
      'vendor/b.md': '[x]()\n',
      'page.mdx': '[x]()\n'
    })
    const off = mergeLayers([{ source: 'repo', input: { rules: { 'pawl/markdown-no-empty-links': 'off' } } }])
    const ignore = mergeLayers([{ source: 'repo', input: { ignore: ['vendor/**', 'README.md'] } }])

    expect(rules(root, off)).toEqual([])
    expect(rules(root, ignore, ['docs/a.md', 'vendor/b.md', 'page.mdx', 'README.md'])).toEqual([
      'docs/a.md:1 markdown-no-empty-links'
    ])
    expect(rules(root, defaultPolicy(), ['docs/a.md', 'missing.md'])).toEqual(['docs/a.md:1 markdown-no-empty-links'])
  })
})
