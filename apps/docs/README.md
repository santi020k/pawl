# pawl website and docs

The site for [pawl.santi020k.com](https://pawl.santi020k.com): a landing page built with [Lumen UI](https://lumen.santi020k.com), and the documentation, built with [Astro Starlight](https://starlight.astro.build).

```sh
pnpm docs:dev     # from the repo root
pnpm docs:build
```

## Layout

| Path                        | What it is                                                                        |
| --------------------------- | --------------------------------------------------------------------------------- |
| `src/pages/index.astro`     | The landing page, composed from Lumen components                                  |
| `src/layouts/Landing.astro` | The landing page shell. It shares Starlight's theme setting                       |
| `src/content/docs/`         | The doc pages. `reference/rules.md` is generated; do not edit it by hand          |
| `src/components/`           | `Terminal`, `RatchetChart` and `PawlMark`, used on both the landing page and docs |
| `src/data/demo.ts`          | Recorded runs of the pawl CLI, shown in the terminals                             |
| `src/styles/tokens.css`     | The brand tokens, in the HSL format Lumen's semantic tokens use                   |
| `src/styles/starlight.css`  | Maps the tokens onto Starlight's color scale and fonts                            |
| `src/assets/`, `public/`    | The mark, the hero art, the favicon and the social card                           |

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

The mark is a checkmark with a ratchet notch in its rising arm. It is a single stroked path on a 32-unit grid, with every segment at 45 degrees; `src/components/PawlMark.astro` has the geometry. `pawl-mark.svg` is lime for dark backgrounds, `pawl-mark-light.svg` is the deep lime for light ones, and `public/favicon.svg` is the app-icon tile.

The hero art (`src/assets/ratchet.webp`) was generated with GPT Image 2.5 through Figma AI. The source images and the logo explorations are in the [pawl brand Figma file](https://www.figma.com/design/d1z9VUiPkk2CEDYpkLd7VA). `public/og.jpg` is the social card, laid out in HTML and rendered at 1200×630.

## Notes

- The terminals show real CLI output. After changing pawl's output format, re-run the commands on a small repo and update `src/data/demo.ts`.
- `biome.json` here turns on Biome's full HTML support, so the linter sees what `.astro` templates use. Without it, every import used only in a template is reported as unused.
- The landing page stores the theme under Starlight's `starlight-theme` key, so a choice made on either side carries over.
- Lumen 5.2.0 renders `ButtonLink variant="inline"` with a class no stylesheet defines; `tokens.css` styles it until Lumen does.
