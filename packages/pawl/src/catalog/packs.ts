import { type Level } from '../types.ts'

/**
 * An optional set of ESLint rules for one plugin.
 *
 * A pack is data only. Pawl never installs or bundles the plugin: the project installs it,
 * and the pack switches on once it is there. That keeps pawl free of dependencies while
 * still covering what only an ESLint plugin can check.
 */
export interface Pack {
  name: string
  title: string
  /** The npm package the project installs to use this pack. */
  plugin: string
  /** The plugin versions the pack was written for. Declared as an optional peer. */
  range: string
  /** The plugin's ESLint namespace. Empty for ESLint's own rules. */
  prefix: string
  /** Dependencies that suggest a project wants this pack. Empty means opt-in only. */
  when: string[]
  /** Where the plugin keeps its recommended rules or flat config. */
  preset?: string[]
  /** The preset is a flat config that brings its own parser or file patterns, so it is used whole. */
  spread?: boolean
  /** Limit the pack's own rules to these files. */
  files?: string[]
  /** Files among those that the pack leaves alone. */
  ignores?: string[]
  /** Where the plugin keeps the parser its files need, for a plugin whose presets are rules only. */
  parser?: string[]
  /** On whenever ESLint is the linter (`linter`), or the linter in a TypeScript project (`linter-ts`). */
  auto?: 'linter' | 'linter-ts'
  /** Some of its rules need type information. */
  typeAware?: boolean
  /**
   * The catalog has rules from this plugin so Biome and Oxlint enforce them natively.
   * ESLint takes those rules only when the pack is on, or when the policy names one.
   */
  withPack?: boolean
  /** Levels the standard sets on top of the preset. */
  rules: Record<string, Level>
}

/**
 * The packs. Their rules and levels come from @santi020k/eslint-config-basic; pawl does not
 * depend on it. Every plugin is installed by the project that wants it.
 */
export const PACKS: readonly Pack[] = [
  {
    name: 'javascript',
    title: 'JavaScript base',
    plugin: '@eslint/js',
    range: '>=9.0.0',
    prefix: '',
    when: [],
    preset: ['configs', 'recommended', 'rules'],
    auto: 'linter',
    rules: {}
  },
  {
    name: 'typescript',
    title: 'TypeScript',
    plugin: 'typescript-eslint',
    range: '>=8.0.0',
    prefix: '@typescript-eslint',
    when: [],
    preset: ['configs', 'recommended'],
    files: ['**/*.{ts,mts,cts,tsx}'],
    auto: 'linter-ts',
    typeAware: true,
    rules: {
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/restrict-template-expressions': 'warn',
      '@typescript-eslint/unbound-method': 'warn'
    }
  },
  {
    name: 'unicorn',
    title: 'Unicorn',
    plugin: 'eslint-plugin-unicorn',
    range: '>=77.0.0',
    prefix: 'unicorn',
    when: [],
    rules: {
      'unicorn/consistent-destructuring': 'warn',
      'unicorn/prefer-switch': 'warn'
    }
  },
  {
    name: 'regexp',
    title: 'Regular expressions',
    plugin: 'eslint-plugin-regexp',
    range: '>=3.0.0',
    prefix: 'regexp',
    when: [],
    preset: ['configs', 'flat/recommended', 'rules'],
    rules: {
      'regexp/no-super-linear-backtracking': 'error',
      'regexp/no-unused-capturing-group': 'warn',
      'regexp/no-useless-escape': 'warn',
      'regexp/prefer-character-class': 'warn'
    }
  },
  {
    name: 'node',
    title: 'Node.js',
    plugin: 'eslint-plugin-n',
    range: '>=18.0.0',
    prefix: 'n',
    when: [],
    preset: ['configs', 'flat/recommended'],
    rules: {
      'n/no-extraneous-import': 'off',
      'n/no-missing-import': 'off',
      'n/no-missing-require': 'off',
      'n/no-process-env': 'off',
      'n/no-process-exit': 'off',
      'n/no-unpublished-import': 'off',
      'n/no-unsupported-features/node-builtins': 'off'
    }
  },
  {
    name: 'promise',
    title: 'Promises',
    plugin: 'eslint-plugin-promise',
    range: '>=7.0.0',
    prefix: 'promise',
    when: [],
    preset: ['configs', 'flat/recommended'],
    rules: {}
  },
  {
    name: 'perfectionist',
    title: 'Perfectionist',
    plugin: 'eslint-plugin-perfectionist',
    range: '>=5.0.0',
    prefix: 'perfectionist',
    when: [],
    preset: ['configs', 'recommended-natural', 'rules'],
    rules: { 'perfectionist/sort-imports': 'off', 'perfectionist/sort-named-imports': 'off' }
  },
  {
    name: 'jsdoc',
    title: 'JSDoc',
    plugin: 'eslint-plugin-jsdoc',
    range: '>=63.0.0',
    prefix: 'jsdoc',
    when: [],
    preset: ['configs', 'flat/recommended-error', 'rules'],
    rules: { 'jsdoc/require-param-type': 'off', 'jsdoc/require-returns': 'off', 'jsdoc/require-returns-type': 'off' }
  },
  {
    name: 'security',
    title: 'Security',
    plugin: 'eslint-plugin-security',
    range: '>=4.0.0',
    prefix: 'security',
    when: [],
    preset: ['configs', 'recommended', 'rules'],
    rules: {}
  },
  {
    name: 'sonarjs',
    title: 'SonarJS',
    plugin: 'eslint-plugin-sonarjs',
    range: '>=4.0.0',
    prefix: 'sonarjs',
    when: [],
    preset: ['configs', 'recommended'],
    rules: {}
  },
  {
    name: 'zod',
    title: 'Zod',
    plugin: 'eslint-plugin-zod',
    range: '>=5.0.0',
    prefix: 'zod',
    when: ['zod'],
    preset: ['configs', 'recommended', 'rules'],
    rules: {
      'zod/array-style': 'error',
      'zod/prefer-enum-over-literal-union': 'error',
      'zod/prefer-loose-object': 'off',
      'zod/prefer-meta': 'error',
      'zod/prefer-meta-last': 'off',
      'zod/prefer-nullish': 'off',
      'zod/prefer-strict-object': 'off',
      'zod/prefer-string-schema-with-trim': 'error',
      'zod/prefer-trim-before-string-length-checks': 'off'
    }
  },
  {
    name: 'stencil',
    title: 'Stencil',
    plugin: '@stencil/eslint-plugin',
    range: '>=1.2.0',
    prefix: 'stencil',
    when: ['@stencil/core'],
    files: ['**/*.{ts,tsx}'],
    typeAware: true,
    rules: {
      'stencil/async-methods': 'error',
      'stencil/ban-prefix': 'error',
      'stencil/decorators-context': 'error',
      'stencil/decorators-style': 'error',
      'stencil/element-type': 'error',
      'stencil/host-data-deprecated': 'error',
      'stencil/methods-must-be-public': 'error',
      'stencil/no-unused-watch': 'error',
      'stencil/own-methods-must-be-private': 'error',
      'stencil/own-props-must-be-private': 'error',
      'stencil/prefer-vdom-listener': 'error',
      'stencil/props-must-be-public': 'error',
      'stencil/props-must-be-readonly': 'error',
      'stencil/render-returns-host': 'error',
      'stencil/required-jsdoc': 'error',
      'stencil/reserved-member-names': 'error',
      'stencil/single-export': 'error',
      'stencil/strict-mutable': 'error'
    }
  },
  {
    name: 'testing-library',
    title: 'Testing Library',
    plugin: 'eslint-plugin-testing-library',
    range: '>=7.0.0',
    prefix: 'testing-library',
    when: ['@testing-library/react', '@testing-library/dom', '@testing-library/vue', '@testing-library/svelte'],
    rules: {
      'testing-library/await-async-queries': 'error',
      'testing-library/no-await-sync-queries': 'off',
      'testing-library/no-debugging-utils': 'off',
      'testing-library/no-dom-import': 'off',
      'testing-library/no-unnecessary-act': 'warn',
      'testing-library/prefer-find-by': 'warn',
      'testing-library/prefer-screen-queries': 'error'
    }
  },
  {
    name: 'jest-dom',
    title: 'jest-dom',
    plugin: 'eslint-plugin-jest-dom',
    range: '>=5.0.0',
    prefix: 'jest-dom',
    when: ['@testing-library/jest-dom'],
    preset: ['configs', 'recommended', 'rules'],
    rules: {}
  },
  {
    name: 'jest',
    title: 'Jest',
    plugin: 'eslint-plugin-jest',
    range: '>=29.0.0',
    prefix: 'jest',
    when: ['jest'],
    preset: ['configs', 'flat/recommended', 'rules'],
    rules: {}
  },
  {
    name: 'vitest',
    title: 'Vitest',
    plugin: '@vitest/eslint-plugin',
    range: '>=1.0.0',
    prefix: 'vitest',
    when: ['vitest'],
    preset: ['configs', 'recommended', 'rules'],
    rules: {}
  },
  {
    name: 'playwright',
    title: 'Playwright',
    plugin: 'eslint-plugin-playwright',
    range: '>=2.0.0',
    prefix: 'playwright',
    when: ['@playwright/test'],
    preset: ['configs', 'flat/recommended'],
    rules: {}
  },
  {
    name: 'storybook',
    title: 'Storybook',
    plugin: 'eslint-plugin-storybook',
    range: '>=10.0.0',
    prefix: 'storybook',
    when: ['storybook'],
    preset: ['configs', 'flat/recommended'],
    spread: true,
    rules: {}
  },
  {
    name: 'nest',
    title: 'NestJS',
    plugin: '@darraghor/eslint-plugin-nestjs-typed',
    range: '>=6.0.0',
    prefix: '@darraghor/nestjs-typed',
    when: ['@nestjs/core'],
    rules: {
      '@darraghor/nestjs-typed/api-method-should-specify-api-response': 'warn',
      '@darraghor/nestjs-typed/api-property-returning-array-should-set-array': 'warn',
      '@darraghor/nestjs-typed/injectable-should-be-provided': 'off'
    }
  },
  {
    name: 'next',
    title: 'Next.js',
    plugin: '@next/eslint-plugin-next',
    range: '>=16.0.0',
    prefix: '@next/next',
    when: ['next'],
    preset: ['configs', 'recommended', 'rules'],
    rules: { '@next/next/no-html-link-for-pages': 'off' }
  },
  {
    name: 'angular',
    title: 'Angular',
    plugin: '@angular-eslint/eslint-plugin',
    range: '>=22.0.0',
    prefix: '@angular-eslint',
    when: ['@angular/core'],
    files: ['**/*.ts'],
    rules: {
      '@angular-eslint/component-class-suffix': 'error',
      '@angular-eslint/directive-class-suffix': 'error',
      '@angular-eslint/no-empty-lifecycle-method': 'warn',
      '@angular-eslint/no-output-native': 'warn',
      '@angular-eslint/use-lifecycle-interface': 'warn',
      '@angular-eslint/use-pipe-transform-interface': 'error'
    }
  },
  {
    name: 'vue',
    title: 'Vue',
    plugin: 'eslint-plugin-vue',
    range: '>=10.0.0',
    prefix: 'vue',
    when: ['vue', 'nuxt'],
    preset: ['configs', 'flat/recommended'],
    spread: true,
    files: ['**/*.vue'],
    rules: { 'vue/padding-line-between-blocks': 'warn' }
  },
  {
    name: 'svelte',
    title: 'Svelte',
    plugin: 'eslint-plugin-svelte',
    range: '>=3.0.0',
    prefix: 'svelte',
    when: ['svelte'],
    preset: ['configs', 'flat/recommended'],
    spread: true,
    files: ['**/*.svelte'],
    rules: {}
  },
  {
    name: 'yaml',
    title: 'YAML',
    plugin: 'eslint-plugin-yml',
    range: '>=3.0.0',
    prefix: 'yml',
    when: [],
    preset: ['configs', 'flat/recommended'],
    spread: true,
    files: ['**/*.{yml,yaml}'],
    rules: { 'yml/no-empty-mapping-value': 'error' }
  },
  {
    name: 'jsonc',
    title: 'JSON',
    plugin: 'eslint-plugin-jsonc',
    range: '>=3.0.0',
    prefix: 'jsonc',
    when: [],
    preset: ['configs', 'flat/recommended-with-jsonc'],
    spread: true,
    files: ['**/*.{json,jsonc,json5}'],
    rules: { 'jsonc/sort-keys': 'warn' }
  },
  {
    name: 'markdown',
    title: 'Markdown',
    plugin: '@eslint/markdown',
    range: '>=8.0.0',
    prefix: 'markdown',
    when: [],
    preset: ['configs', 'recommended'],
    spread: true,
    files: ['**/*.md'],
    rules: {
      'markdown/no-duplicate-headings': 'off',
      'markdown/no-empty-links': 'off',
      'markdown/no-html': 'off',
      'markdown/no-invalid-label-refs': 'error',
      'markdown/no-missing-label-refs': 'off'
    }
  },
  {
    name: 'react-hooks',
    title: 'React Hooks',
    plugin: 'eslint-plugin-react-hooks',
    range: '>=7.0.0',
    prefix: 'react-hooks',
    when: ['react', 'next', 'react-native'],
    preset: ['configs', 'flat', 'recommended-latest'],
    rules: {}
  },
  {
    name: 'jsx-a11y',
    title: 'Accessibility',
    plugin: 'eslint-plugin-jsx-a11y',
    range: '>=6.0.0',
    prefix: 'jsx-a11y',
    when: [],
    preset: ['flatConfigs', 'recommended'],
    withPack: true,
    rules: {}
  },
  {
    name: 'astro',
    title: 'Astro',
    plugin: 'eslint-plugin-astro',
    range: '>=1.0.0',
    prefix: 'astro',
    when: ['astro'],
    preset: ['configs', 'recommended'],
    spread: true,
    files: ['**/*.astro'],
    rules: {}
  },
  {
    name: 'solid',
    title: 'Solid',
    plugin: 'eslint-plugin-solid',
    range: '*',
    prefix: 'solid',
    when: ['solid-js'],
    preset: ['configs', 'flat/recommended'],
    rules: {}
  },
  {
    name: 'lit',
    title: 'Lit',
    plugin: 'eslint-plugin-lit',
    range: '*',
    prefix: 'lit',
    when: ['lit'],
    preset: ['configs', 'flat/recommended'],
    rules: {}
  },
  {
    name: 'cypress',
    title: 'Cypress',
    plugin: 'eslint-plugin-cypress',
    range: '>=7.0.0',
    prefix: 'cypress',
    when: ['cypress'],
    preset: ['configs', 'recommended'],
    rules: {}
  },
  {
    name: 'tanstack-query',
    title: 'TanStack Query',
    plugin: '@tanstack/eslint-plugin-query',
    range: '*',
    prefix: '@tanstack/query',
    when: ['@tanstack/react-query', '@tanstack/vue-query', '@tanstack/solid-query', '@tanstack/svelte-query'],
    preset: ['configs', 'recommended', 'rules'],
    rules: {}
  },
  {
    name: 'i18next',
    title: 'i18next',
    plugin: 'eslint-plugin-i18next',
    range: '>=6.0.0',
    prefix: 'i18next',
    when: ['i18next'],
    preset: ['configs', 'flat/recommended'],
    rules: { 'i18next/no-literal-string': 'warn' }
  },
  {
    name: 'compat',
    title: 'Browser compatibility',
    plugin: 'eslint-plugin-compat',
    range: '*',
    prefix: 'compat',
    when: [],
    preset: ['configs', 'flat/recommended'],
    rules: {}
  },
  {
    name: 'depend',
    title: 'Depend',
    plugin: 'eslint-plugin-depend',
    range: '*',
    prefix: 'depend',
    when: [],
    preset: ['configs', 'flat/recommended'],
    rules: {}
  },
  {
    name: 'cspell',
    title: 'CSpell',
    plugin: '@cspell/eslint-plugin',
    range: '>=10.0.0',
    prefix: '@cspell',
    when: [],
    preset: ['configs', 'recommended'],
    rules: { '@cspell/spellchecker': 'warn' }
  },
  {
    name: 'toml',
    title: 'TOML',
    plugin: 'eslint-plugin-toml',
    range: '*',
    prefix: 'toml',
    when: [],
    preset: ['configs', 'flat/recommended'],
    spread: true,
    files: ['**/*.toml'],
    rules: {}
  },
  {
    name: 'html',
    title: 'HTML',
    plugin: '@html-eslint/eslint-plugin',
    range: '*',
    prefix: '@html-eslint',
    when: [],
    preset: ['configs', 'flat/recommended'],
    spread: true,
    files: ['**/*.html'],
    rules: { '@html-eslint/no-inline-styles': 'warn', '@html-eslint/require-button-type': 'warn' }
  },
  {
    name: 'hono',
    title: 'Hono',
    plugin: 'eslint-plugin-hono',
    range: '*',
    prefix: 'hono',
    when: ['hono'],
    preset: ['configs', 'recommended'],
    rules: {}
  },
  {
    name: 'swagger',
    title: 'Swagger for NestJS',
    plugin: '@darraghor/eslint-plugin-nestjs-typed',
    range: '>=6.0.0',
    prefix: '@darraghor/nestjs-typed',
    when: ['@nestjs/swagger'],
    files: ['**/*.{ts,mts,cts}'],
    typeAware: true,
    rules: {
      '@darraghor/nestjs-typed/api-enum-property-best-practices': 'warn',
      '@darraghor/nestjs-typed/api-method-should-specify-api-operation': 'warn',
      '@darraghor/nestjs-typed/api-method-should-specify-api-response': 'warn',
      '@darraghor/nestjs-typed/api-operation-summary-description-capitalized': 'warn',
      '@darraghor/nestjs-typed/api-property-matches-property-optionality': 'error',
      '@darraghor/nestjs-typed/api-property-returning-array-should-set-array': 'error',
      '@darraghor/nestjs-typed/api-property-should-have-api-extra-models': 'warn',
      '@darraghor/nestjs-typed/controllers-should-supply-api-tags': 'warn',
      '@darraghor/nestjs-typed/swagger-file-upload-should-be-documented': 'warn'
    }
  },
  {
    name: 'preact',
    title: 'Preact',
    plugin: '@eslint-react/eslint-plugin',
    range: '>=2.0.0',
    prefix: '@eslint-react',
    when: ['preact'],
    rules: {
      '@eslint-react/dom-no-missing-button-type': 'warn',
      '@eslint-react/dom-no-unsafe-target-blank': 'warn',
      '@eslint-react/exhaustive-deps': 'warn',
      '@eslint-react/no-array-index-key': 'warn',
      '@eslint-react/no-unstable-default-props': 'warn'
    }
  },
  {
    name: 'tanstack-router',
    title: 'TanStack Router',
    plugin: '@tanstack/eslint-plugin-router',
    range: '*',
    prefix: '@tanstack/router',
    when: ['@tanstack/react-router', '@tanstack/solid-router', '@tanstack/react-start', '@tanstack/solid-start'],
    preset: ['configs', 'flat/recommended'],
    rules: {}
  },
  {
    name: 'ai',
    title: 'AI SDK security',
    plugin: 'eslint-plugin-vercel-ai-security',
    range: '>=3.0.0',
    prefix: 'vercel-ai-security',
    when: ['ai'],
    preset: ['configs', 'recommended', 'rules'],
    rules: {}
  },
  {
    name: 'tailwind',
    title: 'Tailwind CSS',
    plugin: 'eslint-plugin-better-tailwindcss',
    range: '>=4.0.0',
    prefix: 'better-tailwindcss',
    // Opt-in: Biome already has Tailwind rules, and this plugin wants the project's stylesheet in its settings.
    when: [],
    preset: ['configs', 'correctness', 'rules'],
    rules: {}
  },
  {
    name: 'graphql',
    title: 'GraphQL operations',
    plugin: '@graphql-eslint/eslint-plugin',
    range: '>=4.0.0',
    prefix: '@graphql-eslint',
    when: ['graphql'],
    preset: ['configs', 'flat/operations-recommended'],
    parser: ['parser'],
    files: ['**/*.{graphql,gql}'],
    ignores: ['**/*.schema.{graphql,gql}', '**/schema.{graphql,gql}'],
    rules: {}
  },
  {
    name: 'graphql-schema',
    title: 'GraphQL schema',
    plugin: '@graphql-eslint/eslint-plugin',
    range: '>=4.0.0',
    prefix: '@graphql-eslint',
    when: ['graphql'],
    preset: ['configs', 'flat/schema-recommended'],
    parser: ['parser'],
    files: ['**/*.schema.{graphql,gql}', '**/schema.{graphql,gql}'],
    rules: { '@graphql-eslint/no-unreachable-types': 'off' }
  },
  {
    name: 'astro-doctor',
    title: 'Astro Doctor',
    plugin: '@santi020k/eslint-plugin-astro-doctor',
    range: '>=1.0.0',
    prefix: 'astro-doctor',
    when: [],
    preset: ['configs', 'recommended'],
    spread: true,
    files: ['**/*.astro'],
    rules: {}
  },
  {
    name: 'package-json',
    title: 'package.json',
    plugin: 'eslint-plugin-package-json',
    range: '>=1.0.0',
    prefix: 'package-json',
    when: [],
    preset: ['configs', 'recommended'],
    spread: true,
    files: ['**/package.json'],
    rules: {}
  },
  {
    name: 'pnpm',
    title: 'pnpm workspace',
    plugin: 'eslint-plugin-pnpm',
    range: '>=1.0.0',
    prefix: 'pnpm',
    when: [],
    preset: ['configs', 'recommended'],
    spread: true,
    files: ['**/package.json'],
    rules: {}
  }
]

const BY_NAME = new Map(PACKS.map(pack => [pack.name, pack]))

/** A pack by name. `unicorn/recommended` names the unicorn pack, started from the plugin's own preset. */
export const getPack = (name: string): Pack | undefined => BY_NAME.get(name.split('/')[0] ?? name)

/**
 * True for a pack entry that only switches on when the policy names it: one of a plugin's own
 * presets, such as `unicorn/recommended`, or a pack with no dependency to detect it by.
 */
export const onlyWhenNamed = (entry: string): boolean => entry.includes('/') || (getPack(entry)?.when.length ?? 0) === 0

/** The packs whose trigger dependencies a project has. */
export const suggestedPacks = (dependencies: ReadonlySet<string>): Pack[] =>
  PACKS.filter(pack => pack.when.some(name => dependencies.has(name)))
