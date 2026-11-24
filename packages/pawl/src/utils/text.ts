/** A count and a noun, such as "1 file" or "3 files". */
export const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`

/** `noExplicitAny` as `no-explicit-any`, the way Biome's rule pages are named. */
export const kebabCase = (name: string): string => name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)

/** "a", "a and b", "a, b and c". */
export const andList = (items: readonly string[]): string =>
  items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`

/** How far apart two words are, in letters added, removed, changed or swapped with the next one. */
const distance = (a: string, b: string): number => {
  // Row i, column j: the distance from the first i letters of a to the first j letters of b.
  const rows = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 || j === 0 ? i + j : 0))
  )
  const at = (i: number, j: number): number => rows[i]?.[j] ?? 0

  for (let i = 1; i <= a.length; i++) {
    const row = rows[i] as number[]

    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let best = Math.min(at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + cost)

      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) best = Math.min(best, at(i - 2, j - 2) + 1)

      row[j] = best
    }
  }

  return at(a.length, b.length)
}

/**
 * The known word closest to one that was mistyped, when it is close enough to be what was meant:
 * the one word it starts, or a word a letter or two away.
 */
export const closest = (word: string, known: readonly string[]): string | undefined => {
  const typed = word.toLowerCase()
  const started = known.filter(candidate => typed.length >= 2 && candidate.toLowerCase().startsWith(typed))

  if (started.length === 1) return started[0]

  const best = known
    .map(candidate => ({ candidate, far: distance(typed, candidate.toLowerCase()) }))
    .sort((a, b) => a.far - b.far)[0]

  return best && best.far <= Math.max(1, Math.floor(best.candidate.length / 3)) ? best.candidate : undefined
}
