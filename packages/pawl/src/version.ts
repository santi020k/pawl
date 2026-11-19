import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

interface Manifest {
  version: string
  name: string
  engines?: { node?: string }
  peerDependencies?: Record<string, string>
}

const manifest = createRequire(import.meta.url)('../package.json') as Manifest

export const VERSION = manifest.version

export const PACKAGE_NAME = manifest.name

/** The Node versions pawl supports, from its `engines.node`. */
export const NODE_RANGE = manifest.engines?.node ?? '*'

/** The versions of each tool pawl works with, from its peer dependencies. */
export const PEER_RANGES: Readonly<Record<string, string>> = manifest.peerDependencies ?? {}

/** Where pawl itself is installed. Biome is looked up here too when the project does not have it. */
export const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url))
