// Packs @santi020k/pawl, installs the tarball into an empty project and runs the CLI and the
// library entry, the way a consumer would.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const work = mkdtempSync(join(tmpdir(), 'pawl-packed-'))
const run = (command: string, args: string[], cwd: string): string =>
  execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim()

try {
  run('pnpm', ['--filter', '@santi020k/pawl', 'pack', '--pack-destination', work], root)
  const tarball = readdirSync(work).find(name => name.endsWith('.tgz'))
  if (!tarball) throw new Error('pnpm pack did not produce a tarball')

  const project = join(work, 'consumer')
  mkdirSync(project)
  writeFileSync(
    join(project, 'package.json'),
    `${JSON.stringify({ name: 'consumer', private: true, type: 'module' })}\n`
  )
  run('npm', ['install', '--no-audit', '--no-fund', '--ignore-scripts', join(work, tarball)], project)

  const { version } = JSON.parse(readFileSync(join(root, 'packages/pawl/package.json'), 'utf8')) as { version: string }
  const cliVersion = run(join(project, 'node_modules/.bin/pawl'), ['--version'], project)
  if (cliVersion !== version) throw new Error(`Expected pawl ${version}, the packed CLI printed ${cliVersion}`)

  run(
    'node',
    [
      '--input-type=module',
      '-e',
      "const pawl = await import('@santi020k/pawl'); if (typeof pawl.definePolicy !== 'function') process.exit(1)"
    ],
    project
  )
  process.stdout.write(`The packed @santi020k/pawl ${version} installs and runs.\n`)
} finally {
  rmSync(work, { recursive: true, force: true })
}
