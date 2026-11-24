/**
 * Writes api.md, the public surface of @santi020k/pawl: every name src/index.ts exports, with its
 * declaration from the built .d.ts files, and the declarations those refer to. A change to the API
 * shows up as a diff of this file in review, and `pnpm run check:generated` fails when the file is
 * out of date. Comments are left out, so only a change of shape changes the file.
 * Run after the build with: pnpm run api
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(PACKAGE, 'dist')
const ENTRY = join(DIST, 'index.d.ts')

if (!existsSync(ENTRY)) {
  process.stderr.write('dist/index.d.ts is missing. Run "pnpm run build" first.\n')
  process.exit(1)
}

interface Module {
  /** Each top-level declaration, by the name it declares. */
  declarations: Map<string, string>
  /** Each imported name, with the module it comes from. */
  imports: Map<string, string>
  /** Each name the module exports from another module, with that module. */
  reexports: Map<string, string>
}

const modules = new Map<string, Module>()

/** The .d.ts file an import specifier of a .d.ts file points at. */
const resolveModule = (from: string, specifier: string): string =>
  join(dirname(from), specifier.replace(/\.(ts|js)$/, '.d.ts'))

const withoutComments = (text: string): string =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(line => line.trim() !== '' && !line.trim().startsWith('//'))
    .join('\n')

/** The top-level statements of a .d.ts file: a statement starts on a line with no indent. */
const statements = (text: string): string[] => {
  const result: string[] = []

  for (const line of withoutComments(text).split('\n')) {
    if (/^\S/.test(line) && !/^[}\])]/.test(line)) result.push(line)
    else if (result.length > 0) result[result.length - 1] += `\n${line}`
  }

  return result
}

const DECLARED =
  /^(?:export\s+)?(?:declare\s+)?(?:const|let|function|class|interface|type|enum|namespace)\s+([A-Za-z_$][\w$]*)/

const load = (file: string): Module => {
  const known = modules.get(file)

  if (known) return known

  const module: Module = { declarations: new Map(), imports: new Map(), reexports: new Map() }

  modules.set(file, module)

  for (const statement of statements(readFileSync(file, 'utf8'))) {
    const from = /from\s+'([^']+)'/.exec(statement)?.[1]

    if (statement.startsWith('import ') && from) {
      for (const [, name, alias] of statement.matchAll(
        /(?:type\s+)?([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?/g
      )) {
        if (name && !['import', 'type', 'from'].includes(name))
          module.imports.set(alias ?? name, resolveModule(file, from))
      }

      continue
    }

    const reexport = /^export\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'([^']+)'/.exec(statement.replace(/\s+/g, ' '))

    if (reexport) {
      for (const part of (reexport[1] ?? '').split(',')) {
        const name = part
          .trim()
          .split(/\s+as\s+/)
          .pop()

        if (name) module.reexports.set(name, resolveModule(file, reexport[2] ?? ''))
      }

      continue
    }

    const name = DECLARED.exec(statement)?.[1]

    if (name) {
      const before = module.declarations.get(name)

      // Function overloads are several statements for one name.
      module.declarations.set(name, before ? `${before}\n${statement}` : statement)
    }
  }

  return module
}

/** Where a module's name is declared, following the modules that export it from another one. */
const find = (file: string, name: string, seen = new Set<string>()): { file: string; text: string } | undefined => {
  if (seen.has(file) || !existsSync(file)) return undefined

  seen.add(file)

  const module = load(file)
  const text = module.declarations.get(name)

  if (text !== undefined) return { file, text }

  const next = module.reexports.get(name) ?? module.imports.get(name)

  return next === undefined ? undefined : find(next, name, seen)
}

/** The names `export { a, b } from './x.ts'` lists, with the module each comes from. */
const entryExports = (): { name: string; file: string; typeOnly: boolean }[] =>
  statements(readFileSync(ENTRY, 'utf8')).flatMap(statement => {
    const match = /^export\s+(type\s+)?\{([^}]*)\}\s+from\s+'([^']+)'/.exec(statement.replace(/\s+/g, ' '))

    if (!match) return []

    const [, typeOnly, list = '', from = ''] = match

    return list
      .split(',')
      .map(part => part.trim())
      .filter(Boolean)
      .map(part => ({
        name: part.split(/\s+as\s+/).pop() ?? part,
        file: resolveModule(ENTRY, from),
        typeOnly: typeOnly !== undefined
      }))
  })

const identifiers = (text: string): Set<string> => new Set(text.match(/[A-Za-z_$][\w$]*/g) ?? [])

const located = (file: string): string => relative(DIST, file).replace(/\.d\.ts$/, '.ts')

const exported = entryExports()
const publicNames = new Set(exported.map(entry => entry.name))
const referenced = new Map<string, { file: string; text: string }>()

/** The declarations a statement refers to that the package does not export by name. */
const follow = (file: string, text: string): void => {
  const module = load(file)

  for (const word of identifiers(text)) {
    if (publicNames.has(word) || (!module.declarations.has(word) && !module.imports.has(word))) continue

    const found = find(file, word)

    if (found === undefined || referenced.has(`${located(found.file)}#${word}`)) continue
    if (found.file === file && found.text === text) continue

    referenced.set(`${located(found.file)}#${word}`, { file: found.file, text: found.text.replace(/^export\s+/, '') })
    follow(found.file, found.text)
  }
}

const sections: string[] = []

for (const entry of [...exported].sort((a, b) => a.name.localeCompare(b.name))) {
  const found = find(entry.file, entry.name)

  if (found === undefined) throw new Error(`No declaration of ${entry.name} in ${located(entry.file)}`)

  sections.push(
    `### \`${entry.name}\`${entry.typeOnly ? ' (type)' : ''}\n\nFrom \`src/${located(found.file)}\`.\n\n\`\`\`ts\n${found.text}\n\`\`\``
  )
  follow(found.file, found.text)
}

const internal = [...referenced.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([key, { text }]) => {
    const [file, name] = key.split('#')

    return `### \`${name}\`\n\nFrom \`src/${file}\`.\n\n\`\`\`ts\n${text}\n\`\`\``
  })

const document = [
  '# @santi020k/pawl public API',
  '',
  '<!-- Generated by scripts/build-api.ts from the built declarations. Do not edit: run "pnpm run api". -->',
  '',
  `${exported.length} exports. A change here is a change to what users of the package can rely on: say in the changeset whether it breaks them.`,
  '',
  '## Exports',
  '',
  sections.join('\n\n'),
  '',
  '## Types the exports refer to',
  '',
  'Not exported by name, but part of the signatures above, so a change to them is a change to the API too.',
  '',
  internal.length > 0 ? internal.join('\n\n') : 'None.',
  ''
].join('\n')

writeFileSync(join(PACKAGE, 'api.md'), document)
process.stdout.write(`Wrote api.md: ${exported.length} exports, ${referenced.size} referenced types\n`)
