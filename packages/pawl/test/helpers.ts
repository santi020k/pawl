import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The package root, so fixtures can link to pawl and its engines. */
export const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Create a temporary project from a map of relative paths to file contents. */
export const project = (files: Record<string, string | object> = {}): string => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pawl-')))

  write(root, files)

  return root
}

export const write = (root: string, files: Record<string, string | object>): void => {
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`)
  }
}

/** Make pawl, and optionally ESLint, Prettier and oxlint-tsgolint, resolvable from a fixture, as after an install. */
export const link = (
  root: string,
  {
    eslint = false,
    prettier = false,
    tsgolint = false
  }: { eslint?: boolean; prettier?: boolean; tsgolint?: boolean } = {}
): void => {
  mkdirSync(join(root, 'node_modules/@santi020k'), { recursive: true })
  symlinkSync(PACKAGE_ROOT, join(root, 'node_modules/@santi020k/pawl'))

  if (eslint) symlinkSync(join(PACKAGE_ROOT, 'node_modules/eslint'), join(root, 'node_modules/eslint'))

  if (prettier) symlinkSync(join(PACKAGE_ROOT, 'node_modules/prettier'), join(root, 'node_modules/prettier'))

  if (tsgolint) {
    symlinkSync(join(PACKAGE_ROOT, 'node_modules/oxlint-tsgolint'), join(root, 'node_modules/oxlint-tsgolint'))
  }
}
