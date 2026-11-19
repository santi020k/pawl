import { createRequire } from 'node:module'

const manifest = createRequire(import.meta.url)('../package.json') as { version: string; name: string }

export const VERSION = manifest.version

export const PACKAGE_NAME = manifest.name
