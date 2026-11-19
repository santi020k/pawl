import starlight from '@astrojs/starlight'
import { defineConfig } from 'astro/config'
import starlightLinksValidator from 'starlight-links-validator'

const site = 'https://pawl.santi020k.com'

export default defineConfig({
  site,
  integrations: [
    starlight({
      title: 'pawl',
      description: 'Fast guardrails for AI-written code. One standard, for the linter and formatter you choose.',
      logo: {
        dark: './src/assets/pawl-mark.svg',
        light: './src/assets/pawl-mark-light.svg'
      },
      favicon: '/favicon.svg',
      customCss: ['./src/styles/tokens.css', './src/styles/starlight.css'],
      // Starlight already emits og:site_name and twitter:card. The per-page og:image comes from the Head override.
      head: [
        { tag: 'link', attrs: { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' } },
        { tag: 'link', attrs: { rel: 'manifest', href: '/site.webmanifest' } },
        { tag: 'meta', attrs: { name: 'theme-color', content: '#0B0D0C', media: '(prefers-color-scheme: dark)' } },
        { tag: 'meta', attrs: { name: 'theme-color', content: '#F5F7F2', media: '(prefers-color-scheme: light)' } }
      ],
      components: {
        Footer: './src/components/starlight/Footer.astro',
        Head: './src/components/starlight/Head.astro'
      },
      editLink: {
        baseUrl: 'https://github.com/santi020k/pawl/edit/main/apps/docs/'
      },
      lastUpdated: true,
      plugins: [starlightLinksValidator()],
      expressiveCode: {
        themes: ['vitesse-black', 'vitesse-light'],
        styleOverrides: {
          borderRadius: '0.625rem',
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
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/santi020k/pawl' }],
      sidebar: [
        {
          label: 'Start here',
          items: [
            { label: 'Getting started', slug: 'guide/getting-started' },
            { label: 'Install', slug: 'guide/install' },
            { label: 'Coming from ESLint', slug: 'guide/migrate' }
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
            { label: 'CI and hooks', slug: 'guide/ci' },
            { label: 'Monorepos', slug: 'guide/monorepos' },
            { label: 'Troubleshooting', slug: 'guide/troubleshooting' }
          ]
        },
        {
          label: 'Reference',
          items: [
            { label: 'CLI', slug: 'reference/cli' },
            { label: 'Configuration', slug: 'reference/config' },
            { label: 'Rules', slug: 'reference/rules' },
            { label: 'API', slug: 'reference/api' },
            { label: 'Changelog', slug: 'reference/changelog' }
          ]
        }
      ]
    })
  ]
})
