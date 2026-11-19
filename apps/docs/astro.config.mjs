import starlight from '@astrojs/starlight'
import { defineConfig } from 'astro/config'

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
      head: [
        { tag: 'link', attrs: { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' } },
        { tag: 'meta', attrs: { property: 'og:image', content: `${site}/og.jpg` } },
        { tag: 'meta', attrs: { property: 'og:image:width', content: '1200' } },
        { tag: 'meta', attrs: { property: 'og:image:height', content: '630' } },
        { tag: 'meta', attrs: { name: 'twitter:card', content: 'summary_large_image' } },
        { tag: 'meta', attrs: { name: 'theme-color', content: '#0B0D0C' } }
      ],
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
            { label: 'Guards and Docker checks', slug: 'guide/guards' }
          ]
        },
        {
          label: 'Workflows',
          items: [
            { label: 'Coding agents', slug: 'guide/agents' },
            { label: 'CI and hooks', slug: 'guide/ci' },
            { label: 'Monorepos', slug: 'guide/monorepos' }
          ]
        },
        {
          label: 'Reference',
          items: [
            { label: 'CLI', slug: 'reference/cli' },
            { label: 'Rules', slug: 'reference/rules' },
            { label: 'API', slug: 'reference/api' }
          ]
        }
      ]
    })
  ]
})
