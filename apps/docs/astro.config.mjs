import starlight from '@astrojs/starlight'
import { defineConfig } from 'astro/config'
import starlightLinksValidator from 'starlight-links-validator'

const site = 'https://pawl.santi020k.com'

export default defineConfig({
  site,
  integrations: [
    starlight({
      title: 'pawl',
      // The site's description, kept in step with siteDescription in src/metadata.ts. Every doc page has its own.
      description:
        'Fast guardrails for AI-written code: one lint and format standard for Biome, Oxlint, ESLint and Prettier, with a baseline so only new findings fail.',
      logo: {
        dark: './src/assets/pawl-mark.svg',
        light: './src/assets/pawl-mark-light.svg'
      },
      favicon: '/favicon.svg',
      customCss: ['./src/styles/tokens.css', './src/styles/starlight.css'],
      // Starlight already emits og:site_name and twitter:card. The per-page og:image comes from the Head override.
      head: [
        // For browsers without SVG favicons. Chrome and Firefox still pick the SVG, since this one names its size.
        { tag: 'link', attrs: { rel: 'icon', href: '/favicon.ico', sizes: '32x32' } },
        { tag: 'link', attrs: { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' } },
        { tag: 'link', attrs: { rel: 'manifest', href: '/site.webmanifest' } },
        { tag: 'meta', attrs: { name: 'theme-color', content: '#0B0D0C', media: '(prefers-color-scheme: dark)' } },
        { tag: 'meta', attrs: { name: 'theme-color', content: '#F5F7F2', media: '(prefers-color-scheme: light)' } },
        // Starlight writes the language alone ("en"); Open Graph wants language and territory, as the landing page has.
        { tag: 'meta', attrs: { property: 'og:locale', content: 'en_US' } }
      ],
      components: {
        Footer: './src/components/starlight/Footer.astro',
        Head: './src/components/starlight/Head.astro',
        Hero: './src/components/starlight/Hero.astro',
        MarkdownContent: './src/components/starlight/MarkdownContent.astro'
      },
      editLink: {
        baseUrl: 'https://github.com/santi020k/pawl/edit/main/apps/docs/'
      },
      lastUpdated: true,
      // Adds the changelog's versions to its table of contents. See src/route-data.ts.
      routeMiddleware: './src/route-data.ts',
      plugins: [starlightLinksValidator()],
      expressiveCode: {
        themes: ['vitesse-black', 'vitesse-light'],
        styleOverrides: {
          borderRadius: 'var(--ui-radius-lg)',
          borderColor: 'var(--sl-color-hairline)',
          codeBackground: 'hsl(var(--surface))',
          codeFontFamily: 'var(--pawl-font-mono)',
          uiFontFamily: 'var(--pawl-font)',
          frames: {
            editorTabBarBackground: 'hsl(var(--surface-muted))',
            editorActiveTabBackground: 'hsl(var(--surface))',
            editorActiveTabIndicatorTopColor: 'hsl(var(--brand))',
            terminalBackground: 'hsl(var(--surface))',
            terminalTitlebarBackground: 'hsl(var(--surface-muted))',
            terminalTitlebarBorderBottomColor: 'var(--sl-color-hairline)',
            frameBoxShadowCssValue: 'none'
          }
        }
      },
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/santi020k/pawl' },
        { icon: 'npm', label: 'npm', href: 'https://www.npmjs.com/package/@santi020k/pawl' }
      ],
      sidebar: [
        {
          label: 'Start here',
          items: [
            { label: 'Getting started', slug: 'guide/getting-started' },
            { label: 'Install', slug: 'guide/install' },
            { label: 'Coming from ESLint', slug: 'guide/migrate' },
            { label: 'Upgrading', slug: 'guide/upgrade' }
          ]
        },
        {
          label: 'Concepts',
          items: [
            { label: 'The ratchet', slug: 'guide/ratchet' },
            { label: 'The policy', slug: 'guide/policy' },
            { label: 'Choosing tools', slug: 'guide/tools' },
            { label: 'Packs', slug: 'guide/packs' },
            { label: 'Guards and file checks', slug: 'guide/guards' }
          ]
        },
        {
          label: 'Workflows',
          items: [
            { label: 'Coding agents', slug: 'guide/agents' },
            { label: 'Editors', slug: 'guide/editors' },
            { label: 'CI and hooks', slug: 'guide/ci' },
            { label: 'With Quality', slug: 'guide/quality' },
            { label: 'Monorepos', slug: 'guide/monorepos' },
            { label: 'Rust, Swift and Kotlin', slug: 'guide/languages' },
            { label: 'Troubleshooting', slug: 'guide/troubleshooting' }
          ]
        },
        {
          label: 'Adoption and integration',
          collapsed: true,
          items: [
            { label: 'Strict adoption', slug: 'guide/strict-adoption' },
            { label: 'Shared ESLint configs', slug: 'guide/shared-eslint' },
            { label: 'Astro coverage', slug: 'guide/framework-coverage' },
            { label: 'Generated scopes', slug: 'guide/generated-scopes' },
            { label: 'Import-sort ownership', slug: 'guide/formatter-ownership' },
            { label: 'Test runners', slug: 'guide/test-runners' },
            { label: 'ESLint caching', slug: 'guide/eslint-cache' },
            { label: 'Lint task ownership', slug: 'guide/lint-ownership' },
            { label: 'Task reachability', slug: 'guide/task-reachability' },
            { label: 'Reviewed exceptions', slug: 'guide/reviewed-exceptions' },
            { label: 'JSON report contract', slug: 'guide/report-contract' }
          ]
        },
        {
          label: 'Reference',
          items: [
            { label: 'CLI', slug: 'reference/cli' },
            { label: 'Configuration', slug: 'reference/config' },
            { label: 'Rules', slug: 'reference/rules' },
            { label: 'API', slug: 'reference/api' }
          ]
        },
        { label: 'Changelog', slug: 'changelog' }
      ]
    })
  ]
})
