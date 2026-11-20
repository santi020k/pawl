import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { listFiles } from '../project/files.ts'
import { ignoreMatcher } from '../project/ignores.ts'
import { type Finding, type Level, type Policy } from '../types.ts'

/**
 * Pawl's own checks for Dockerfiles and Compose files.
 *
 * No engine pawl drives reads these files, so the checks live here. They are few on purpose:
 * each one catches something that is wrong in nearly every project, with a plain line scan.
 */
export interface DockerRule {
  name: string
  level: Level
  summary: string
  advice: string
}

const rule = (name: string, level: Level, summary: string, advice: string): DockerRule => ({
  name: `pawl/${name}`,
  level,
  summary,
  advice
})

export const DOCKER_RULES: readonly DockerRule[] = [
  rule(
    'docker-pin-image',
    'warn',
    'A base image has no version, or uses "latest".',
    'Name a version, such as node:22-slim, so builds repeat.'
  ),
  rule(
    'docker-no-root',
    'warn',
    'The image runs as root.',
    'Add a USER instruction with a non-root user before the image ends.'
  ),
  rule(
    'docker-no-secrets',
    'error',
    'A secret is written into the image.',
    'Pass it at run time, or use a build secret (RUN --mount=type=secret).'
  ),
  rule(
    'docker-prefer-copy',
    'warn',
    'ADD is used for a local file.',
    'Use COPY. ADD is for remote URLs and for unpacking archives.'
  ),
  rule(
    'docker-no-sudo',
    'warn',
    'A build step uses sudo.',
    'Run the step as root with USER, then switch back to the non-root user.'
  ),
  rule(
    'docker-apt-no-recommends',
    'warn',
    'apt-get install pulls in recommended packages.',
    'Add --no-install-recommends to keep the image small.'
  ),
  rule(
    'docker-npm-ci',
    'warn',
    'Dependencies are installed with "npm install".',
    'Use "npm ci" so the image gets exactly what the lockfile says.'
  ),
  rule(
    'docker-exec-form',
    'warn',
    'CMD or ENTRYPOINT is in shell form.',
    'Use the JSON form, such as CMD ["node", "server.js"], so the process receives stop signals.'
  ),
  rule(
    'docker-no-curl-pipe',
    'warn',
    'A download is piped straight into a shell.',
    'Download the file, check it, then run it.'
  ),
  rule('docker-workdir-absolute', 'warn', 'WORKDIR is a relative path.', 'Use an absolute path, such as /app.'),
  rule(
    'docker-no-maintainer',
    'warn',
    'MAINTAINER is deprecated.',
    'Use LABEL org.opencontainers.image.authors="...".'
  ),
  rule(
    'compose-pin-image',
    'warn',
    'A service image has no version, or uses "latest".',
    'Name a version, such as postgres:17.'
  ),
  rule(
    'compose-no-privileged',
    'warn',
    'A service runs privileged.',
    'Grant the single capability it needs with cap_add.'
  ),
  rule(
    'compose-no-secrets',
    'error',
    'A secret is written into the Compose file.',
    'Reference a variable from the environment, or use Compose secrets.'
  ),
  rule(
    'compose-no-docker-socket',
    'warn',
    'A service mounts the Docker socket.',
    'That gives the container control of the host. Remove the mount or use a socket proxy.'
  ),
  rule('compose-no-host-network', 'warn', 'A service uses the host network.', 'Publish the ports it needs instead.'),
  rule('compose-no-version', 'warn', 'The top-level "version" key is obsolete.', 'Remove it. Compose ignores it.')
]

const BY_NAME = new Map(DOCKER_RULES.map(def => [def.name, def]))

export const getDockerRule = (name: string): DockerRule | undefined => BY_NAME.get(name)

// "Dockerfile.prod" is one. "Dockerfile.ts" is source code that happens to share the name.
const DOCKERFILE =
  /(^|\/)(Dockerfile|Containerfile)(?!\.(?:[cm]?[jt]sx?|json|md|ya?ml|txt)$)(\.[\w.-]+)?$|\.(dockerfile|containerfile)$/i

const COMPOSE = /(^|\/)(docker-)?compose(\.[\w.-]+)?\.ya?ml$/

export const isDockerFile = (file: string): boolean => DOCKERFILE.test(file) || COMPOSE.test(file)

const SECRET_NAME = /(PASSWORD|PASSWD|SECRET|TOKEN|API_?KEY|PRIVATE_?KEY|ACCESS_?KEY|CREDENTIALS?)/i

/** A value that is a real secret, not empty, a reference to a variable, or a path to a file. */
const isLiteralSecret = (name: string, value: string): boolean => {
  const bare = value.trim().replace(/^["']|["']$/g, '')

  if (bare.length === 0 || /\$[{(\w]/.test(bare)) return false

  return SECRET_NAME.test(name) && !/_FILE$|_PATH$/i.test(name)
}

/** An image reference that names no version: no tag and no digest, or the "latest" tag. */
const isUnpinned = (image: string): boolean => {
  if (image.includes('@sha256:') || image.includes('$')) return false

  const last = image.slice(image.lastIndexOf('/') + 1)
  const tag = last.includes(':') ? last.slice(last.indexOf(':') + 1) : undefined

  return tag === undefined || tag === 'latest'
}

interface Instruction {
  line: number
  keyword: string
  args: string
}

/** The instructions that take a heredoc. */
const HEREDOC_KEYWORDS = new Set(['RUN', 'COPY', 'ADD'])

/**
 * A heredoc as BuildKit reads one: a word of its own, `<<EOF`, `<<-EOF` or `<<"EOF"`. A here-string
 * (`<<<`) and a shift in shell arithmetic (`1 << 4`) are not one, and must not hide the lines after them.
 */
const HEREDOC = /(?:^|\s)\d*<<-?(["']?)([A-Za-z_][^<\s"']*)\1(?=\s|$)/g

/** Split a Dockerfile into instructions, joining continued lines and skipping comments and heredocs. */
const parseDockerfile = (text: string): Instruction[] => {
  const instructions: Instruction[] = []
  const lines = text.split(/\r?\n/)
  /** The end markers of the heredocs still open, in the order they close. */
  const heredocs: string[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index] ?? ''

    if (heredocs.length > 0) {
      if (raw.trim() === heredocs[0]) heredocs.shift()

      continue
    }

    if (/^\s*(#|$)/.test(raw)) continue

    const start = index
    let joined = raw

    while (/\\\s*$/.test(joined) && index + 1 < lines.length) {
      index += 1

      const next = lines[index] ?? ''

      joined = /^\s*#/.test(next) ? joined : `${joined.replace(/\\\s*$/, ' ')}${next.trim()}`
    }

    const match = /^\s*([A-Za-z]+)\s*(.*)$/.exec(joined)

    if (!match) continue

    const keyword = (match[1] ?? '').toUpperCase()

    instructions.push({ line: start + 1, keyword, args: (match[2] ?? '').trim() })

    if (HEREDOC_KEYWORDS.has(keyword)) heredocs.push(...[...joined.matchAll(HEREDOC)].map(found => found[2] ?? ''))
  }

  return instructions
}

type Report = (name: string, line: number, detail?: string) => void

const checkRun = (args: string, line: number, report: Report): void => {
  if (/(^|[\s;&|(])sudo\s/.test(args)) report('docker-no-sudo', line)

  if (/apt-get\s+(-\S+\s+)*install\b/.test(args) && !args.includes('--no-install-recommends'))
    report('docker-apt-no-recommends', line)

  // A bare install: nothing after it but flags, up to the end of the command.
  if (/(^|[\s;&|(])npm\s+(install|i)(\s+-\S+)*\s*($|&&|;|\|\|)/.test(args)) report('docker-npm-ci', line)

  if (/\b(curl|wget)\b[^|;&]*\|\s*(sudo\s+)?(ba|z|da)?sh\b/.test(args)) report('docker-no-curl-pipe', line)
}

const checkDockerfile = (text: string, report: Report): void => {
  const instructions = parseDockerfile(text)
  const stages = new Set<string>()
  let lastFrom: Instruction | undefined
  let user: string | undefined

  for (const { keyword, args, line } of instructions) {
    if (keyword === 'FROM') {
      const [image = '', , alias] = args.replace(/^--platform=\S+\s+/, '').split(/\s+/)

      if (image !== 'scratch' && !stages.has(image.toLowerCase()) && isUnpinned(image))
        report('docker-pin-image', line, image)

      if (alias) stages.add(alias.toLowerCase())

      lastFrom = { keyword, args: image, line }
      user = undefined
    } else if (keyword === 'USER') user = args.split(':')[0]
    else if (keyword === 'RUN') checkRun(args, line, report)
    else if (keyword === 'ENV' || keyword === 'ARG') {
      // Both "NAME=value" pairs and the older "ENV NAME value" form.
      const pairs = args.includes('=')
        ? [...args.matchAll(/([\w.-]+)=("[^"]*"|'[^']*'|\S*)/g)].map(match => [match[1] ?? '', match[2] ?? ''])
        : [[args.split(/\s+/)[0] ?? '', args.split(/\s+/).slice(1).join(' ')]]

      for (const [name = '', value = ''] of pairs) {
        if (isLiteralSecret(name, value)) report('docker-no-secrets', line, name)
      }
    } else if (keyword === 'ADD') {
      const sources = args
        .split(/\s+/)
        .filter(part => !part.startsWith('--'))
        .slice(0, -1)
      const needsAdd = sources.some(source => /^(https?:|git@)|\.(tar(\.\w+)?|tgz|tbz2|txz)$/i.test(source))

      if (sources.length > 0 && !needsAdd) report('docker-prefer-copy', line)
    } else if (keyword === 'CMD' || keyword === 'ENTRYPOINT') {
      if (!args.startsWith('[')) report('docker-exec-form', line, keyword)
    } else if (keyword === 'WORKDIR') {
      if (!/^["']?(\/|\$|[A-Za-z]:[\\/])/.test(args)) report('docker-workdir-absolute', line)
    } else if (keyword === 'MAINTAINER') report('docker-no-maintainer', line)
  }

  const runsAsRoot = user === undefined || user === 'root' || user === '0'

  // An image tagged "nonroot" already drops root, and an image with no instructions is only a base.
  if (lastFrom && runsAsRoot && !/nonroot/.test(lastFrom.args)) report('docker-no-root', lastFrom.line)
}

const indentOf = (line: string): number => line.length - line.trimStart().length

const checkCompose = (text: string, report: Report): void => {
  const lines = text.split(/\r?\n/)
  /** The indent of the `environment:` block the scan is inside, when it is inside one. */
  let environment: number | undefined

  for (const [index, raw] of lines.entries()) {
    const line = raw.replace(/\s+#.*$/, '')
    const number = index + 1

    if (/^\s*(#|$)/.test(line)) continue

    const indent = indentOf(line)

    if (environment !== undefined && indent <= environment) environment = undefined

    if (/^version\s*:/.test(line)) report('compose-no-version', number)

    const image = /^\s*image\s*:\s*["']?([^"'\s]+)["']?\s*$/.exec(line)?.[1]

    if (image && isUnpinned(image)) report('compose-pin-image', number, image)

    if (/^\s*privileged\s*:\s*true\s*$/.test(line)) report('compose-no-privileged', number)

    if (/^\s*network_mode\s*:\s*["']?host["']?\s*$/.test(line)) report('compose-no-host-network', number)

    if (/\/var\/run\/docker\.sock/.test(line)) report('compose-no-docker-socket', number)

    if (environment !== undefined) {
      // Both forms: a mapping (NAME: value) and a list (- NAME=value).
      const pair = /^\s*(?:-\s*)?["']?([\w.-]+)["']?\s*[:=]\s*(.*)$/.exec(line)

      if (pair && isLiteralSecret(pair[1] ?? '', pair[2] ?? '')) report('compose-no-secrets', number, pair[1])
    }

    if (/^\s*environment\s*:\s*$/.test(line)) environment = indent
  }
}

export interface DockerOptions {
  root: string
  policy: Policy
  /** Only look at these files, relative to the root. */
  files?: readonly string[]
}

/** Check every Dockerfile and Compose file in the project. */
export const checkDocker = ({ root, policy, files }: DockerOptions): Finding[] => {
  const ignored = ignoreMatcher(root, policy)
  const findings: Finding[] = []

  for (const file of (files ?? listFiles(root)).filter(name => isDockerFile(name) && !ignored(name))) {
    const path = join(root, file)

    if (!existsSync(path)) continue

    const report: Report = (short, line, detail) => {
      const def = BY_NAME.get(`pawl/${short}`) as DockerRule
      const severity = policy.rules[def.name] ?? def.level

      if (severity === 'off') return

      findings.push({
        file,
        line,
        column: 1,
        engine: 'pawl',
        engineRule: def.name,
        rule: def.name,
        severity,
        message: `${def.summary.replace(/\.$/, '')}${detail ? ` (${detail})` : ''}. ${def.advice}`,
        fixable: false
      })
    }
    const text = readFileSync(path, 'utf8')

    if (COMPOSE.test(file)) checkCompose(text, report)
    else checkDockerfile(text, report)
  }

  return findings
}
