import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { POLICY_KEYS, POLICY_SCHEMA } from '../src/policy/schema.ts'
import { PACKAGE_ROOT } from './helpers.ts'

const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as {
  files: string[]
  exports: Record<string, string>
}

describe('the policy schema', () => {
  it('is in step with src/policy/schema.ts (run "pnpm run schema" if this fails)', () => {
    expect(JSON.parse(readFileSync(join(PACKAGE_ROOT, 'pawl.config.schema.json'), 'utf8'))).toEqual(POLICY_SCHEMA)
  })

  it('lists every option of a policy and nothing else', () => {
    expect(Object.keys(POLICY_SCHEMA.properties ?? {})).toEqual(POLICY_KEYS)
    expect(POLICY_SCHEMA.additionalProperties).toBe(false)
  })

  it('ships in the package and is exported', () => {
    expect(manifest.files).toContain('pawl.config.schema.json')
    expect(manifest.exports['./schema.json']).toBe('./pawl.config.schema.json')
  })
})
