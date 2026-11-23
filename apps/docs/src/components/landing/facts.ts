/**
 * Numbers the landing page states, read at build time so they cannot go stale.
 * The docs deploy builds this site without building packages/pawl, so nothing here may import
 * from its dist or src: only committed files. `pnpm run docs:rules` writes counts.json from the catalog,
 * and `pnpm run check:generated` fails if it is out of date.
 */

import pawlPackage from '../../../../../packages/pawl/package.json'
import counts from '../../data/counts.json'
import { npmUrl } from '../../metadata.ts'

/** RULES.length: the rules in the standard. */
export const ruleCount = counts.rules

/** PACKS.length: the optional ESLint plugin packs. */
export const packCount = counts.packs

/** DOCKER_RULES.length: pawl's own checks for Dockerfiles and Compose files. */
export const dockerCheckCount = counts.dockerChecks

/** Runtime dependencies of the library. Every engine, formatter and plugin is an optional peer. */
export const dependencyCount = Object.keys(
  (pawlPackage as { dependencies?: Record<string, string> }).dependencies ?? {}
).length

export { npmUrl }
