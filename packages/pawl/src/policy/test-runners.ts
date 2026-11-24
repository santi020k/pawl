import { testRunnerForRule } from '../catalog/test-runners.ts'
import { type Policy } from '../types.ts'

/** Undefined keeps existing enforcement. A named runner is limited to its explicitly declared files. */
export const testRunnerFiles = (
  policy: Pick<Policy, 'testRunners'>,
  rule: string,
  sharedAssertions = false
): string[] | undefined => {
  const runner = testRunnerForRule(rule)

  if (!runner) return undefined

  if (sharedAssertions && (runner === 'vitest' || runner === 'jest')) {
    const files = [...(policy.testRunners.vitest ?? []), ...(policy.testRunners.jest ?? [])]

    return files.length > 0 ? [...new Set(files)] : undefined
  }

  return policy.testRunners[runner]
}
