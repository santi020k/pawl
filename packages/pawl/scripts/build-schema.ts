/**
 * Writes the JSON schema of pawl.config.json from the policy schema in src/schema.ts.
 * Run with: pnpm run schema
 */
import { writeFileSync } from 'node:fs'
import { POLICY_SCHEMA } from '../src/schema.ts'

writeFileSync(new URL('../pawl.config.schema.json', import.meta.url), `${JSON.stringify(POLICY_SCHEMA, null, 2)}\n`)
process.stdout.write('Wrote pawl.config.schema.json\n')
