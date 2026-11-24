import { BIOME_VERSION } from '../engines/biome/config.ts'
import { type Project } from '../policy/project.ts'
import { allTechnologies } from '../project/detect.ts'

/** Known engine boundaries, not evidence that a project's separate framework checks are missing. */
export const frameworkLimitations = ({ detection, tools }: Project): string[] => {
  if (!allTechnologies(detection).includes('astro')) return []

  const limitations: string[] = []

  if (tools.linter === 'biome') {
    limitations.push(
      `Biome ${BIOME_VERSION} does not fully resolve Astro's virtual modules (astro:content and astro:transitions/client) or .astro component exports. Keep astro check and astro build as separate validators. This notice does not suppress import/no-unresolved; ordinary missing imports must still fail.`
    )
  }

  if (tools.linter === 'biome' || tools.formatter === 'biome') {
    limitations.push(
      `Biome ${BIOME_VERSION} accepts html.experimentalFullSupportEnabled in overrides but does not reliably apply it to Astro template expressions. A scoped opt-in is not proof of parser coverage. Keep astro check and astro build; review a root-level opt-in separately, and preserve customized nested configs until their semantics can be maintained.`
    )
  }

  return limitations
}
