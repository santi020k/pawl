/** A count and a noun, such as "1 file" or "3 files". */
export const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`

/** `noExplicitAny` as `no-explicit-any`, the way Biome's rule pages are named. */
export const kebabCase = (name: string): string => name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)
