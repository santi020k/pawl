import { makeIgnore } from './ignores.ts'
import { type Level, type Override, type Policy } from './types.ts'

const overrideMatchers = new WeakMap<Override, (file: string) => boolean>()

/** True when an override's patterns name a file. */
const overrideCovers = (override: Override, file: string): boolean => {
  const matcher = overrideMatchers.get(override) ?? makeIgnore(override.files)

  overrideMatchers.set(override, matcher)

  return matcher(file)
}

/**
 * The level of one of pawl's own checks for one file: the policy's level, else the check's own,
 * then the overrides that name the file, the later ones winning, as the engines read them.
 */
export const levelForFile = (policy: Policy, name: string, file: string, fallback: Level): Level =>
  policy.overrides.reduce(
    (level, override) =>
      name in override.rules && overrideCovers(override, file) ? (override.rules[name] as Level) : level,
    policy.rules[name] ?? fallback
  )
