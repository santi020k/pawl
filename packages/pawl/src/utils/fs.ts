import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'

/** The directories from `start` up to the filesystem root, nearest first. */
export const ancestors = (start: string): string[] => {
  const dirs = [resolve(start)]

  while (dirname(dirs.at(-1) as string) !== dirs.at(-1)) dirs.push(dirname(dirs.at(-1) as string))

  return dirs
}

/** A path with forward slashes, as pawl keeps every path. */
export const toPosix = (path: string): string => (sep === '/' ? path : path.split(sep).join('/'))

/** True when the path exists and is a regular file. */
export const isFile = (path: string): boolean => {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/** True when the path exists and is a folder. */
export const isDirectory = (path: string): boolean => {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** Write a file, creating its folder first. */
export const writeText = (file: string, text: string): void => {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text)
}
