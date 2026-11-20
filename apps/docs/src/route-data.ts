/**
 * Starlight route middleware. The changelog page's versions come from a component, so Starlight cannot see their
 * headings: this adds them to the page's table of contents, after "Overview", and dates the page by its newest release.
 */
import { defineRouteMiddleware } from '@astrojs/starlight/route-data'

import { getReleases } from './releases.ts'

export const onRequest = defineRouteMiddleware(async context => {
  const route = context.locals.starlightRoute

  if (route.id !== 'changelog') return

  const releases = await getReleases()
  const newest = releases.find(release => release.date)?.date

  if (newest && (!route.lastUpdated || newest > route.lastUpdated)) route.lastUpdated = newest

  if (!route.toc) return

  const [overview, ...rest] = route.toc.items
  const versions = releases.map(release => ({ depth: 2, slug: release.id, text: release.title, children: [] }))

  route.toc.items = overview ? [overview, ...versions, ...rest] : [...versions, ...rest]
})
