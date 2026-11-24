/**
 * The ratchet on the baseline itself. A branch that records findings in `.pawl/baseline.json`
 * makes the check allow more than it did, and nothing else in the check would notice: the new
 * findings are now old ones. With `--since <ref>`, a check compares the baseline with the one on
 * that branch, and fails when it allows more, unless a person accepted that with a commit trailer.
 */

import { type Finding } from '../types.ts'
import { plural } from '../utils/text.ts'
import { BASELINE_FILE, type Baseline } from './baseline.ts'

export const BASELINE_GROWTH = 'pawl/no-baseline-growth'

/** The commit trailer a person adds to accept a baseline that allows more: `Pawl-Baseline: accept`. */
export const ACCEPT_TRAILER = 'Pawl-Baseline'

/** The trailer's values that accept it. */
export const accepts = (value: string): boolean => /^accept(?:ed)?$/i.test(value.trim())

/** What a baseline allows that the one before it did not, one line each. Empty when it allows no more. */
export const baselineGrowth = (before: Baseline | undefined, after: Baseline | undefined): string[] => {
  if (!after) return []

  const lines: string[] = []

  for (const [file, rules] of Object.entries(after.findings)) {
    for (const [rule, count] of Object.entries(rules)) {
      const was = before?.findings[file]?.[rule] ?? 0

      if (count > was) lines.push(`${file}: ${plural(count - was, `more ${rule} finding`)}`)
    }
  }

  for (const [file, count] of Object.entries(after.suppressions)) {
    const was = before?.suppressions[file] ?? 0

    if (count > was) lines.push(`${file}: ${plural(count - was, 'more disable comment')}`)
  }

  for (const [file, counts] of Object.entries(after.tests ?? {})) {
    const was = before?.tests?.[file]

    if (!was) continue

    if (counts.assertions < was.assertions)
      lines.push(`${file}: ${plural(was.assertions - counts.assertions, 'assertion')} fewer`)

    if (counts.skipped > was.skipped)
      lines.push(`${file}: ${plural(counts.skipped - was.skipped, 'more skipped test')}`)

    // A count that was not there had no floor, so it is not more than before.
    if (counts.masks !== undefined && was.masks !== undefined && counts.masks > was.masks) {
      const more = counts.masks - was.masks

      lines.push(
        `${file}: ${more} more ${more === 1 ? 'retry, raised timeout or fixed sleep' : 'retries, raised timeouts or fixed sleeps'}`
      )
    }
  }

  // A test file whose floor is gone has no floor at all.
  for (const file of Object.keys(before?.tests ?? {})) {
    if (after.tests !== undefined && !(file in after.tests)) lines.push(`${file}: no longer counted`)
  }

  return lines.sort()
}

const SHOWN = 5

/** The finding for a baseline that allows more than the one on `ref`, at the baseline file. */
export const growthFinding = (ref: string, lines: readonly string[], severity: Finding['severity']): Finding => {
  const shown = lines.slice(0, SHOWN).join('; ')
  const more = lines.length > SHOWN ? `; and ${plural(lines.length - SHOWN, 'more')}` : ''

  return {
    file: BASELINE_FILE,
    line: 1,
    column: 1,
    engine: 'pawl',
    engineRule: 'no-baseline-growth',
    rule: BASELINE_GROWTH,
    severity,
    message: `The baseline allows more than it does on ${ref}: ${shown}${more}. Fix the findings instead of recording them. If a person decided to accept them, add "${ACCEPT_TRAILER}: accept" to a commit message on this branch.`,
    fixable: false
  }
}
