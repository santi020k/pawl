/** Turn "one, many or none" into a list. */
export const toList = <T>(value: T | readonly T[] | undefined): T[] => {
  if (value === undefined) return []

  return Array.isArray(value) ? [...(value as readonly T[])] : [value as T]
}

/**
 * Give every item to an async task and collect the results in the order of the items, whichever
 * task ends first. Together starts every task at once; otherwise each waits for the one before it.
 */
export const mapAsync = async <T, R>(
  items: readonly T[],
  task: (item: T) => Promise<R>,
  { together }: { together: boolean }
): Promise<R[]> => {
  if (together) return Promise.all(items.map(item => task(item)))

  const results: R[] = []

  for (const item of items) results.push(await task(item))

  return results
}
