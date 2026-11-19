/**
 * `santi-og audit` reads the built site in dist/ and checks every page's title, description, robots, canonical,
 * Open Graph and X tags, JSON-LD and social image, plus the sitemap and robots.txt. Run it after `astro build`.
 */
import { defineAuditConfig } from '@santi020k/og/audit/config'
import { standardAuditRules } from '@santi020k/og/audit/rules'

export default defineAuditConfig({
  directory: 'dist',
  siteUrl: 'https://pawl.santi020k.com',
  ...standardAuditRules({ sitemap: { reportOrphans: true } })
})
