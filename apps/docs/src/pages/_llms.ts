/**
 * The doc pages as plain Markdown, for coding agents and AI assistants (https://llmstxt.org).
 * [...slug].md.ts serves each page at its URL plus ".md", llms.txt.ts lists them, and llms-full.txt.ts joins them.
 * `santi-og audit` checks that all three cover every indexable page.
 */
import { type CollectionEntry, getCollection } from 'astro:content'

import { npmPackage, npmUrl, repositoryUrl, siteDescription, siteName, siteUrl } from '../metadata.ts'

type Doc = CollectionEntry<'docs'>

const sections: Readonly<Record<string, string>> = { guide: 'Guides', reference: 'Reference' }

/** Every published doc page, sorted by path, so the pages of one folder sit together. */
export const docs = async (): Promise<Doc[]> =>
  (await getCollection('docs', entry => entry.id !== '404' && entry.data.draft !== true)).sort((left, right) =>
    left.id.localeCompare(right.id)
  )

export const pageUrl = (doc: Doc): string => `${siteUrl}/${doc.id}/`
export const markdownUrl = (doc: Doc): string => `${siteUrl}/${doc.id}.md`

const fence = /^\s*(`{3,}|~{3,})/u
// A line that is only a component tag or an expression, such as <Steps>, <Terminal lines={run} /> or {run && <Terminal />}.
const jsxLine = /^\s*(<\/?[A-Z][\w.]*(\s[^>]*)?\/?>|\{.*\})\s*$/u
// A component that renders something of its own, such as a terminal or a chart, rather than wrapping Markdown.
const figureLine = /^\s*(<[A-Z][^>]*\/>|\{.*<[A-Z].*\})\s*$/u
const tabLabel = /^(\s*)<TabItem\s[^>]*\blabel="([^"]+)"[^>]*>\s*$/u
const asideStart = /^\s*:::(\w+)(?:\[(.*)\])?\s*$/u
const asideEnd = /^\s*:::\s*$/u
const comment = /^\s*<!--[\s\S]*?-->\s*$/u

/**
 * The page body without what only renders on the site: MDX imports, exports and component tags, and HTML comments.
 * Asides become block quotes, and links to other pages become absolute URLs.
 */
const body = (doc: Doc): string => {
  const mdx = doc.filePath?.endsWith('.mdx') ?? false
  const lines: string[] = []
  let openFence: string | undefined
  let inEsm = false
  let inAside = false

  for (const line of (doc.body ?? '').split('\n')) {
    const marker = fence.exec(line)?.[1]
    const quote = (text: string): string => (inAside ? `>${text ? ` ${text}` : ''}` : text)

    if (openFence) {
      lines.push(quote(line))

      if (marker && marker[0] === openFence[0] && marker.length >= openFence.length && line.trim() === marker) {
        openFence = undefined
      }

      continue
    }

    if (marker) {
      openFence = marker
      lines.push(quote(line))
      continue
    }

    if (inEsm) {
      inEsm = line.trim() !== ''
      continue
    }

    if (mdx && /^(import|export)\s/u.test(line)) {
      inEsm = true
      continue
    }

    if (mdx && figureLine.test(line)) {
      lines.push(quote(`(The web page shows a figure here: ${pageUrl(doc)})`))
      continue
    }

    const tab = mdx ? tabLabel.exec(line) : null

    // A tab's label names what is in it, such as a package manager, so it stays as a line of its own.
    if (tab) {
      lines.push(quote(`${tab[1]}**${tab[2]}:**`))
      continue
    }

    if ((mdx && jsxLine.test(line)) || comment.test(line)) continue

    const aside = asideStart.exec(line)

    if (aside && !inAside) {
      const kind = aside[1] ?? 'note'

      inAside = true
      lines.push(`> **${aside[2] || kind.charAt(0).toUpperCase() + kind.slice(1)}:**`)
      continue
    }

    if (inAside && asideEnd.test(line)) {
      inAside = false
      continue
    }

    lines.push(quote(line.replaceAll('](/', `](${siteUrl}/`)))
  }

  return lines
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
}

/** One page as Markdown: its title, its description, then its content. */
export const pageMarkdown = (doc: Doc): string => {
  const description = doc.data.description ? `> ${doc.data.description}\n\n` : ''

  return `# ${doc.data.title}\n\n${description}${body(doc)}\n`
}

const summary = [
  `# ${siteName}`,
  '',
  `> ${siteDescription}`,
  '',
  `pawl is the npm package \`${npmPackage.name}\` (version ${npmPackage.version}, MIT license), a TypeScript library and CLI for Node ${npmPackage.node.replace('>=', '')} or later. It compiles one rule standard for the linter and formatter a repo chooses, and keeps a baseline, the ratchet, so existing findings are allowed and new ones fail. Set up a repo with \`npx ${npmPackage.name} init\`.`,
  '',
  `- Website: ${siteUrl}/`,
  `- Source: ${repositoryUrl}`,
  `- npm: ${npmUrl}`
]

/** The llms.txt index: what pawl is, then a link to each page's Markdown with its description, by section. */
export const llmsIndex = async (): Promise<string> => {
  const pages = await docs()
  const start = pages.find(doc => doc.id === 'guide/getting-started')
  const groups = Map.groupBy(pages, doc => sections[doc.id.split('/')[0] ?? ''] ?? 'Docs')

  const lists = [...groups].flatMap(([section, entries]) => [
    '',
    `## ${section}`,
    '',
    ...entries.map(
      doc => `- [${doc.data.title}](${markdownUrl(doc)})${doc.data.description ? `: ${doc.data.description}` : ''}`
    )
  ])

  return `${[
    ...summary,
    ...(start ? [`- Start here: ${markdownUrl(start)}`] : []),
    `- Every page below in one file: ${siteUrl}/llms-full.txt`,
    ...lists
  ].join('\n')}\n`
}

/** llms-full.txt: what pawl is, then every page in full, each with its address on the site. */
export const llmsFull = async (): Promise<string> => {
  const pages = (await docs()).map(doc =>
    pageMarkdown(doc)
      .trim()
      .replace('\n\n', `\n\nSource: ${pageUrl(doc)}\n\n`)
  )

  return `${[summary.join('\n'), ...pages].join('\n\n')}\n`
}

export const textResponse = (text: string, type: 'markdown' | 'plain'): Response =>
  new Response(text, { headers: { 'Content-Type': `text/${type}; charset=utf-8` } })
