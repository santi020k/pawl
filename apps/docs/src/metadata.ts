/**
 * The site facts that the landing page and the doc pages share, for @santi020k/og's metadata and JSON-LD helpers.
 * astro.config.mjs keeps its own copy of the URL and description, which Starlight reads.
 */
import { personSchema, webSiteSchema } from '@santi020k/og/schema'

export const siteUrl = 'https://pawl.santi020k.com'
export const siteName = 'pawl'
export const siteDescription =
  'Fast guardrails for AI-written code. One standard, for the linter and formatter you choose.'
export const locale = 'en_US'

// The same directives @santi020k/og writes for an indexable page: allow the large social image and full snippets.
export const indexRobots = 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1'

export const author = personSchema(
  { id: `${siteUrl}/#author`, name: 'Santiago Molina', url: 'https://santi020k.com' },
  { alternateName: 'santi020k' }
)

export const website = webSiteSchema({
  id: `${siteUrl}/#website`,
  name: siteName,
  url: `${siteUrl}/`,
  description: siteDescription,
  inLanguage: 'en',
  publisher: author
})
