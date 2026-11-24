import { type TestRunner } from '../types.ts'
import { canonicalName, getRuleByBiome } from './rules.ts'

export const TEST_RUNNERS: readonly TestRunner[] = ['vitest', 'jest', 'playwright', 'node']

/** Shared focused/skipped checks keep their global floors; assertion conventions belong to a runner. */
export const testRunnerForRule = (name: string): TestRunner | undefined => {
  const bare = name.replace(/^(?:eslint|oxlint|biome):/, '')
  const canonical = canonicalName(getRuleByBiome(bare)?.name ?? bare)

  if (/\/(?:no-focused-tests|no-only-tests|no-disabled-tests|no-skipped-tests)$/.test(canonical)) return undefined

  return TEST_RUNNERS.find(runner => canonical.startsWith(`${runner}/`))
}
