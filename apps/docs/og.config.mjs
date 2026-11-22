/**
 * The social cards for the doc pages, one per page, written to public/og/ before `astro build`.
 * The Head override reads them from /og/<page>.webp, the file name @santi020k/og derives from the URL.
 * The landing page keeps its hand-made card, public/og.jpg.
 */
import { createPathCards } from '@santi020k/og'
import { collectContentCards } from '@santi020k/og/content'
import { definePresetConfig } from '@santi020k/og/presets'

const badges = { guide: 'Guide', reference: 'Reference' }

// A card has room for about two lines of description. A page's description is written for search results and runs
// longer, so a long one gives the card its first sentence or clause instead of being cut off mid-phrase.
const cardDescription = description => {
  if (description.length <= 105) return description

  const end = /[.:]\s/u.exec(description)?.index

  return end === undefined ? description : `${description.slice(0, end)}.`
}

const docs = () =>
  collectContentCards({
    directory: 'src/content/docs',
    map: entry => {
      const title = entry.frontmatter.title
      const description = entry.frontmatter.description

      if (typeof title !== 'string') return null

      return {
        badge: badges[entry.slug.split('/')[0]] ?? 'Docs',
        description: typeof description === 'string' ? cardDescription(description) : undefined,
        title
      }
    }
  })

const extra = createPathCards([
  {
    pathname: '/404',
    data: { badge: 'Docs', title: 'Page not found', description: 'Fast guardrails for AI-written code.' }
  }
])

export default definePresetConfig({
  cards: async () => [...(await docs()), ...extra],
  clean: true,
  concurrency: 'auto',
  outputDirectory: 'public/og',
  preset: {
    brand: { domain: 'pawl.santi020k.com', logo: 'public/favicon.svg', name: 'pawl' },
    theme: {
      accent: '#B6F23A',
      background: '#0B0D0C',
      foreground: '#E9F0EA',
      muted: '#B4C0B6',
      panel: '#111412'
    },
    variant: 'docs'
  }
})
