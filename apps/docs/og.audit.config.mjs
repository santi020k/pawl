/**
 * `santi-og audit` reads the built site in dist/ and checks every page's title, description, robots, canonical,
 * Open Graph and X tags, JSON-LD and social image, plus the sitemap and robots.txt. Run it after `astro build`.
 * It also checks llms.txt, llms-full.txt and each doc page's Markdown copy (src/pages/_llms.ts).
 */
import { defineAuditConfig } from '@santi020k/og/audit/config'
import { standardAuditRules } from '@santi020k/og/audit/rules'

const siteUrl = 'https://pawl.santi020k.com'

export default defineAuditConfig({
  directory: 'dist',
  siteUrl,
  // Every indexable page has its own card; two pages sharing one means a card failed to generate.
  requireUniqueImages: true,
  ...standardAuditRules({
    llms: {},
    robots: { expectedSitemaps: [`${siteUrl}/sitemap-index.xml`] },
    sitemap: { reportOrphans: true }
  })
})
