/**
 * Writes the Biome presets of the default standard into presets/.
 * Projects extend them as "@santi020k/pawl/biome" and, per technology, "@santi020k/pawl/biome/react".
 * Run with: pnpm run preset
 *
 * The files are not named biome.json on purpose: Biome treats every biome.json it finds
 * in a repo as a nested configuration.
 */
import { writeFileSync } from 'node:fs'
import { GATED_TAGS } from '../src/catalog/rules.ts'
import { biomeConfig, biomeTechConfig } from '../src/engines/biome/config.ts'
import { defaultPolicy } from '../src/policy/load.ts'

const write = (name: string, config: unknown): void => {
  writeFileSync(new URL(`../presets/${name}`, import.meta.url), `${JSON.stringify(config, null, 2)}\n`)
  process.stdout.write(`Wrote presets/${name}\n`)
}

write('pawl.biome.json', biomeConfig(defaultPolicy()))

for (const technology of GATED_TAGS) write(`${technology}.biome.json`, biomeTechConfig(defaultPolicy(), technology))
