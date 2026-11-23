import { defineCollection } from 'astro:content'
import { fileURLToPath } from 'node:url'
import { docsLoader } from '@astrojs/starlight/loaders'
import { docsSchema } from '@astrojs/starlight/schema'
import { z } from 'astro/zod'

import { historyFiles, readHistory } from './history.ts'

/**
 * Every pawl release for the changelog page, read from the repository by ./history.ts. Each group of notes is
 * rendered to HTML here, with the same Markdown pipeline as the doc pages.
 */
const releases = defineCollection({
  loader: {
    name: 'pawl-releases',
    load: async ({ config, store, parseData, renderMarkdown, generateDigest, logger, watcher }) => {
      const root = fileURLToPath(new URL('../../', config.root))

      const sync = async (): Promise<void> => {
        const history = readHistory(root)

        store.clear()

        for (const [order, release] of history.entries()) {
          const id = release.version ?? 'next'
          const packages = await Promise.all(
            release.packages.map(async notes => ({
              name: notes.name,
              groups: await Promise.all(
                notes.groups.map(async group => ({
                  kind: group.kind,
                  html: (await renderMarkdown(group.markdown)).html
                }))
              )
            }))
          )
          const data = await parseData({ id, data: { ...release, order, packages } })

          store.set({ id, data, digest: generateDigest(data) })
        }
      }

      await sync()

      if (watcher) {
        const watched = new Set(historyFiles(root))

        watcher.add([...watched, `${root}.changeset`])
        watcher.on('all', (_event, path) => {
          if (watched.has(path) || (path.startsWith(`${root}.changeset`) && path.endsWith('.md'))) {
            sync().catch((error: unknown) => logger.error(`Could not reload the release history: ${String(error)}`))
          }
        })
      }
    }
  },
  schema: z.object({
    version: z.string().optional(),
    date: z.string().optional(),
    order: z.number(),
    packages: z.array(
      z.object({
        name: z.string(),
        groups: z.array(z.object({ kind: z.string(), html: z.string() }))
      })
    )
  })
})

export const collections = {
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
  releases
}
