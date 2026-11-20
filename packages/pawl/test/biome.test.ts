import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GATED_TAGS } from '../src/catalog/rules.ts'
import {
  BIOME_PRESET,
  BIOME_REACT_PRESET,
  biomeConfig,
  biomePackageConfig,
  biomeProjectConfig,
  biomeTechConfig,
  biomeTechPreset,
  checkBiomeConfig
} from '../src/engines/biome/config.ts'
import { defaultPolicy, mergeLayers } from '../src/policy/load.ts'
import { PACKAGE_ROOT, project } from './helpers.ts'

const preset = (name: string): unknown => JSON.parse(readFileSync(join(PACKAGE_ROOT, 'presets', name), 'utf8'))

describe('Biome presets', () => {
  it('are in step with the default standard (run "pnpm run preset" if this fails)', () => {
    expect(preset('pawl.biome.json')).toEqual(biomeConfig(defaultPolicy()))
    for (const technology of GATED_TAGS) {
      expect(preset(`${technology}.biome.json`)).toEqual(biomeTechConfig(defaultPolicy(), technology))
    }
  })

  it('carry the house style', () => {
    expect(biomeConfig(defaultPolicy())).toMatchObject({
      formatter: { indentStyle: 'space', indentWidth: 2, lineWidth: 120 },
      javascript: {
        formatter: {
          quoteStyle: 'single',
          semicolons: 'asNeeded',
          trailingCommas: 'none',
          arrowParentheses: 'asNeeded'
        }
      }
    })
  })

  it('keep React rules out of the base preset', () => {
    const rules = JSON.stringify(biomeConfig(defaultPolicy()))

    expect(rules).not.toContain('useHookAtTopLevel')
    expect(JSON.stringify(biomeTechConfig(defaultPolicy(), 'react'))).toContain('useHookAtTopLevel')
  })

  it('carry the jsx-a11y standard in the React preset', () => {
    const react = biomeTechConfig(defaultPolicy(), 'react') as { linter: { rules: Record<string, object> } }

    expect(react.linter.rules.a11y).toMatchObject({
      useAltText: 'error',
      noStaticElementInteractions: 'error',
      noNoninteractiveElementInteractions: 'error'
    })
    expect(JSON.stringify(biomeConfig(defaultPolicy()))).not.toContain('useAltText')
  })
})

describe('biomeProjectConfig', () => {
  it('is a single extends line on the default standard', () => {
    expect(biomeProjectConfig(defaultPolicy())).toEqual({ extends: [BIOME_PRESET] })
    expect(biomeProjectConfig(defaultPolicy(), { technologies: ['react'] })).toEqual({
      extends: [BIOME_PRESET, BIOME_REACT_PRESET]
    })
  })

  it('adds only what the policy changes', () => {
    const policy = mergeLayers([
      {
        source: 'repo',
        input: {
          style: { quotes: 'double', indent: 'tab' },
          rules: { 'no-console': 'off', 'biome:style/useNamingConvention': 'warn', 'vue/no-unused-vars': 'error' },
          ignore: ['generated/**', 'vendor']
        }
      }
    ])

    expect(biomeProjectConfig(policy)).toEqual({
      extends: [BIOME_PRESET],
      files: { includes: ['!generated', '!**/vendor'] },
      formatter: { indentStyle: 'tab' },
      javascript: { formatter: { quoteStyle: 'double' } },
      linter: { rules: { style: { useNamingConvention: 'warn' }, suspicious: { noConsole: 'off' } } }
    })
  })

  it('includes a React override only for React projects', () => {
    const policy = mergeLayers([{ source: 'repo', input: { rules: { 'react/no-danger': 'error' } } }])

    expect(biomeProjectConfig(policy)).toEqual({ extends: [BIOME_PRESET] })
    expect(biomeProjectConfig(policy, { technologies: ['react'] })).toMatchObject({
      linter: { rules: { security: { noDangerouslySetInnerHtml: 'error' } } }
    })
  })
})

describe('technologies and options', () => {
  it('extends one preset per technology, in a fixed order', () => {
    expect(biomeProjectConfig(defaultPolicy(), { technologies: ['turbo', 'vue', 'react'] }).extends).toEqual([
      BIOME_PRESET,
      biomeTechPreset('react'),
      biomeTechPreset('vue'),
      biomeTechPreset('turbo')
    ])
    expect(biomeTechPreset('qwik')).toBe('@santi020k/pawl/biome/qwik')
  })

  it('keeps each technology out of the base preset', () => {
    const base = JSON.stringify(biomeConfig(defaultPolicy()))

    for (const rule of [
      'useHookAtTopLevel',
      'useQwikClasslist',
      'useVueMultiWordComponentNames',
      'noUndeclaredEnvVars'
    ]) {
      expect(base).not.toContain(rule)
    }

    expect(JSON.stringify(biomeTechConfig(defaultPolicy(), 'qwik'))).toContain('useQwikClasslist')
  })

  it('passes the options the standard needs, and keeps them when the level changes', () => {
    const standard = biomeConfig(defaultPolicy()) as { linter: { rules: { correctness: Record<string, unknown> } } }

    expect(standard.linter.rules.correctness.noUnusedVariables).toEqual({
      level: 'error',
      options: { ignoreRestSiblings: true }
    })

    const policy = mergeLayers([
      { source: 'repo', input: { rules: { '@typescript-eslint/no-unused-vars': 'warn', 'no-var': 'off' } } }
    ])

    // The alias sets the rule it stands for, and a rule with options is written whole.
    expect(biomeProjectConfig(policy)).toEqual({
      extends: [BIOME_PRESET],
      linter: {
        rules: {
          correctness: { noUnusedVariables: { level: 'warn', options: { ignoreRestSiblings: true } } },
          suspicious: { noVar: 'off' }
        }
      }
    })
  })

  it('switches off the half of Biome another tool has taken over', () => {
    expect(biomeProjectConfig(defaultPolicy(), { lint: false })).toEqual({
      extends: [BIOME_PRESET],
      linter: { enabled: false }
    })
    expect(biomeProjectConfig(defaultPolicy(), { format: false })).toEqual({
      extends: [BIOME_PRESET],
      formatter: { enabled: false }
    })
  })

  it('turns unstable Biome rules on only under a strict policy', () => {
    const rules = (strict: boolean) =>
      (
        biomeConfig(mergeLayers([{ source: 'repo', input: { strict } }])) as {
          linter: { rules: { nursery: Record<string, string> } }
        }
      ).linter.rules.nursery

    expect(rules(false).noFloatingPromises).toBe('off')
    expect(rules(true).noFloatingPromises).toBe('error')
  })
})

describe('checkBiomeConfig', () => {
  const strict = mergeLayers([{ source: 'repo', input: { rules: { 'no-console': 'off' } } }])

  it('reports a missing file', () => {
    expect(checkBiomeConfig(project(), defaultPolicy()).status).toBe('missing')
  })

  it('reports a file that does not extend the standard', () => {
    const root = project({ 'biome.json': { formatter: { lineWidth: 80 } } })

    expect(checkBiomeConfig(root, defaultPolicy())).toMatchObject({
      status: 'foreign',
      issue: { code: 'biome-config-foreign' }
    })
  })

  it('accepts a file in line with the policy, with user keys on top', () => {
    const root = project({
      'biome.jsonc': `{
  // our own addition
  "extends": ["${BIOME_PRESET}"],
  "linter": { "rules": { "suspicious": { "noConsole": "off" }, "a11y": { "useAltText": "error" } } },
}
`
    })

    expect(checkBiomeConfig(root, strict)).toMatchObject({ status: 'ok', file: 'biome.jsonc', preset: BIOME_PRESET })
  })

  it('reports drift from the policy', () => {
    const root = project({ 'biome.json': { extends: [BIOME_PRESET] } })

    expect(checkBiomeConfig(root, strict).status).toBe('stale')
    expect(checkBiomeConfig(root, defaultPolicy(), { technologies: ['react'] }).status).toBe('stale')
    expect(checkBiomeConfig(root, defaultPolicy()).status).toBe('ok')
  })

  it('gives a monorepo package the root config plus its own technology, however the preset is referred to', () => {
    expect(biomePackageConfig('apps/web', ['next', 'react'])).toEqual({
      root: false,
      extends: ['../../biome.json', '@santi020k/pawl/biome/react', '@santi020k/pawl/biome/next']
    })
    expect(
      biomePackageConfig('docs', ['astro'], 'biome.jsonc', './packages/pawl/presets/pawl.biome.json').extends
    ).toEqual(['../biome.jsonc', '../packages/pawl/presets/astro.biome.json'])
  })

  it('recognises the preset file by path inside the pawl repo', () => {
    const root = project({ 'biome.json': { extends: ['./packages/pawl/presets/pawl.biome.json'] } })

    expect(checkBiomeConfig(root, defaultPolicy()).status).toBe('ok')
    expect(
      biomeProjectConfig(defaultPolicy(), { technologies: ['react'] }, './presets/pawl.biome.json').extends
    ).toEqual(['./presets/pawl.biome.json', './presets/react.biome.json'])
  })
})
