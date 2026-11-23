/** Turn "one, many or none" into a list. */
export const toList = <T>(value: T | readonly T[] | undefined): T[] => {
  if (value === undefined) return []

  return Array.isArray(value) ? [...(value as readonly T[])] : [value as T]
}
