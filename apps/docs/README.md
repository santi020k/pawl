# pawl website and docs

The site for [pawl.santi020k.com](https://pawl.santi020k.com): a landing page built with [Lumen UI](https://lumen.santi020k.com), and the documentation, built with [Astro Starlight](https://starlight.astro.build).

```sh
pnpm docs:dev     # from the repo root
pnpm docs:build   # writes the social cards, builds, and fails on a broken internal link
pnpm --filter @santi020k/pawl-docs run typecheck   # astro check
pnpm --filter @santi020k/pawl-docs run doctor      # Astro Doctor
```

`astro check` does not support TypeScript 7 yet, so this package type-checks with TypeScript 6 from the `astro-check` catalog in `pnpm-workspace.yaml`. The library still uses TypeScript 7.

## Layout

| Path                        | What it is                                                                                |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| `src/pages/index.astro`     | The landing page, composed from Lumen components                                          |
| `src/layouts/Landing.astro` | The landing page shell. It shares Starlight's theme setting                               |
| `src/content/docs/`         | The doc pages. `reference/rules.md` is generated; do not edit it by hand                  |
| `src/components/`           | `Terminal`, `RatchetChart` and `PawlMark`, used on both the landing page and docs         |
| `src/components/landing/`   | The landing header, with its mobile menu (a Lumen `Drawer`), and footer                   |
| `src/components/starlight/` | Starlight overrides: `Head` adds the per-page social card, `Footer` adds the credit line  |
| `src/data/demo.ts`          | Recorded runs of the pawl CLI, shown in the terminals                                     |
| `src/metadata.ts`           | The site URL, name, author and `WebSite` node that both heads share                       |
| `src/styles/tokens.css`     | The brand tokens, in the HSL format Lumen's semantic tokens use                           |
| `src/styles/starlight.css`  | Maps the tokens onto Starlight's color scale and fonts                                    |
| `src/assets/`, `public/`    | The mark, the hero art, the favicon, the social card, `robots.txt` and `site.webmanifest` |
| `og.config.mjs`             | The doc pages' social cards, written by `@santi020k/og` to `public/og/` (not committed)   |
| `og.audit.config.mjs`       | The settings for `santi-og audit`, which checks the built site's metadata                 |

## Social cards

The landing page uses the hand-made `public/og.jpg`. Every doc page gets its own card: `pnpm run og` (also the first step of `build`) reads each page's title and description and writes `public/og/<page>.webp`. The `Head` override points `og:image` and `twitter:image` at it.

`@santi020k/og` also writes the metadata on both halves of the site. The landing layout renders its `MetadataHead` with the hand-made card, and the Starlight `Head` override adds the card tags to Starlight's own. Both add JSON-LD from the library's schema helpers: `WebSite` and `SoftwareApplication` on the landing page, `TechArticle` on each doc page.

`pnpm --filter @santi020k/pawl-docs run audit` checks the built `dist/`: titles, descriptions, canonicals, robots, Open Graph and X tags, JSON-LD, that every social image exists at 1200×630, the sitemap and `robots.txt`. CI and the deploy workflow run it after the build.

## Deploy

`.github/workflows/deploy-docs.yml` builds the site and deploys `dist` to the Cloudflare Pages project `pawl-docs` with `wrangler pages deploy`. It runs on a push to `main` that touches `apps/docs/`, `packages/pawl/` or the lockfile, and on demand from the Actions tab. It uses the GitHub environment `docs-production`, which gets two secrets from Doppler (project `pawl`, config `prd`) through a Doppler sync. Change them in Doppler, not in GitHub:

| Secret                  | What it is                                               |
| ----------------------- | -------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | An API token with the Cloudflare Pages: Edit permission  |
| `CLOUDFLARE_ACCOUNT_ID` | The Cloudflare account that owns the `pawl-docs` project |

The first run creates the `pawl-docs` Pages project (Direct Upload, production branch `main`) when the account does not have it. Then add `pawl.santi020k.com` as its custom domain once, in the Cloudflare dashboard, which also writes the DNS record. Every deploy after that goes through the workflow.

## The brand

The direction is called Signal: dark first, a near-black canvas, pale mint text and one electric lime signal. It does not follow the santi020k brand.

| Token        | Dark      | Light     |
| ------------ | --------- | --------- |
| Canvas       | `#0B0D0C` | `#F5F7F2` |
| Surface      | `#111412` | `#FFFFFF` |
| Line         | `#2C342E` | `#C9D2C6` |
| Ink          | `#E9F0EA` | `#0E1210` |
| Brand (text) | `#B6F23A` | `#3D6B00` |

Buttons use lime `#B6F23A` with near-black text in both themes. Every text color meets WCAG AA on its background. Type is Geist and Geist Mono.

The mark is a checkmark with a ratchet notch in its rising arm. It is a single stroked path on a 32-unit grid, with every segment at 45 degrees; `src/components/PawlMark.astro` has the geometry. `pawl-mark.svg` is lime for dark backgrounds, `pawl-mark-light.svg` is the deep lime for light ones, and `public/favicon.svg` is the app-icon tile. `favicon.ico` (16 and 32 px) and `icon-192.png` / `icon-512.png` are rendered from it, so re-render them after changing the tile.

The hero art (`src/assets/ratchet.webp`) was generated with GPT Image 2.5 through Figma AI. The source images and the logo explorations are in the [pawl brand Figma file](https://www.figma.com/design/d1z9VUiPkk2CEDYpkLd7VA). `public/og.jpg` is the social card, laid out in HTML and rendered at 1200×630.

## Notes

- The terminals show real CLI output. After changing pawl's output format, re-run the commands on a small repo and update `src/data/demo.ts`.
- `biome.json` here turns on Biome's full HTML support, so the linter sees what `.astro` templates use. Without it, every import used only in a template is reported as unused.
- The landing page stores the theme under Starlight's `starlight-theme` key, so a choice made on either side carries over.
- Lumen 5.2.0 renders `ButtonLink variant="inline"` with a class no stylesheet defines; `tokens.css` styles it until Lumen does.
