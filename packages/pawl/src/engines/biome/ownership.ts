import { createHash } from 'node:crypto'
import { lstatSync } from 'node:fs'
import { join } from 'node:path'
import { isRecord, type JsonRecord, readJson } from '../../utils/json.ts'

export const BIOME_OWNERSHIP_FILE = '.pawl/biome-overrides.json'

/** Hash exactly the generated array, including order and options; never infer ownership from its shape. */
export const overridesHash = (config: JsonRecord): string =>
  createHash('sha256')
    .update(JSON.stringify(config.overrides ?? []))
    .digest('hex')

export const biomeOwnership = (file: string, config: JsonRecord): JsonRecord => ({
  version: 1,
  config: file,
  overridesHash: overridesHash(config)
})

/** Missing, malformed and older metadata grant no permission to replace existing scopes. */
export const ownsBiomeOverrides = (root: string, file: string, config: JsonRecord): boolean => {
  const directory = lstatSync(join(root, '.pawl'), { throwIfNoEntry: false })
  if (!directory?.isDirectory() || directory.isSymbolicLink()) return false

  const metadata = lstatSync(join(root, BIOME_OWNERSHIP_FILE), { throwIfNoEntry: false })
  if (!metadata?.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) return false

  const record = readJson<unknown>(join(root, BIOME_OWNERSHIP_FILE))

  return (
    isRecord(record) && record.version === 1 && record.config === file && record.overridesHash === overridesHash(config)
  )
}
