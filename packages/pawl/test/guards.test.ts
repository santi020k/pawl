import { describe, expect, it } from 'vitest'
import { activeGuards, GUARDS, importRestrictions, syntaxRestrictions } from '../src/catalog/guards.ts'
import { eslintPlan } from '../src/engines/eslint/plan.ts'
import { oxlintConfig } from '../src/engines/oxlint/config.ts'
import { defaultPolicy, mergeLayers } from '../src/policy/merge.ts'
import { checkDocker, DOCKER_RULES, isDockerFile } from '../src/scans/docker.ts'
import { planInit } from '../src/setup/init.ts'
import { applyPlan } from '../src/setup/plan.ts'
import { project } from './helpers.ts'

describe('guards', () => {
  it('switch on for the libraries a project depends on, scoped packages included', () => {
    expect(activeGuards(['react'])).toEqual([])
    expect(activeGuards(['@langchain/core']).map(guard => guard.name)).toEqual(['ai-keys', 'langchain'])
    expect(activeGuards(['hono']).map(guard => guard.name)).toEqual(['hono'])
  })

  it('have a message for everything they refuse', () => {
    for (const guard of GUARDS) {
      const entries = [...(guard.paths ?? []), ...(guard.patterns ?? []), ...(guard.syntax ?? [])]

      expect(entries.length, guard.name).toBeGreaterThan(0)
      expect(
        entries.every(entry => entry.message.length > 20),
        guard.name
      ).toBe(true)
    }
  })

  it("merge with the policy's own restrictions, and turn off with the rule", () => {
    const own = mergeLayers([
      { source: 'repo', input: { options: { 'no-restricted-imports': [{ paths: ['lodash'], patterns: [] }] } } }
    ])
    const restricted = importRestrictions(own, ['@google/generative-ai'])

    expect(restricted?.eslint.paths).toHaveLength(2)
    expect(restricted?.biome.paths).toMatchObject({ lodash: 'Do not import "lodash".' })
    expect(Object.keys(restricted?.biome.paths ?? {})).toContain('@google/generative-ai')

    const off = mergeLayers([{ source: 'repo', input: { rules: { 'no-restricted-imports': 'off' } } }])

    expect(importRestrictions(off, ['langchain'])).toBeUndefined()
    expect(importRestrictions(defaultPolicy(), [])).toBeUndefined()
    expect(syntaxRestrictions(defaultPolicy(), ['openai'])?.options).toHaveLength(3)
  })

  it('go to ESLint as two core rules, and leave what Biome runs to Biome', async () => {
    const root = project({ 'package.json': { name: 'x' } })
    const own = mergeLayers([{ source: 'repo', input: { options: { 'no-restricted-syntax': ['WithStatement'] } } }])
    const base = async (biomeActive: boolean, policy = defaultPolicy()) => {
      const plan = await eslintPlan({
        root,
        policy,
        biomeActive,
        typescript: false,
        dependencies: ['openai', 'hono']
      })

      return (plan.config.find(entry => entry.name === 'pawl/base') as { rules: Record<string, unknown[]> }).rules
    }

    expect((await base(false))['no-restricted-imports']?.[0]).toBe('error')
    expect((await base(false))['no-restricted-syntax']).toHaveLength(5)
    expect((await base(true))['no-restricted-imports']).toBeUndefined()
    expect((await base(true))['no-restricted-syntax']).toBeUndefined()
    expect((await base(true, own))['no-restricted-syntax']).toEqual(['error', 'WithStatement'])
  })

  it("go to Oxlint in ESLint's shape", () => {
    const config = oxlintConfig(defaultPolicy(), { dependencies: ['langchain'] }) as {
      rules: Record<string, unknown[]>
    }

    expect(config.rules['no-restricted-imports']?.[0]).toBe('error')
  })
})

const DOCKERFILE = `FROM node AS build
WORKDIR app
ENV API_KEY=abc123secret NODE_ENV=production
ARG NPM_TOKEN
ADD . /app
ADD https://example.com/tool.tar.gz /opt/
RUN apt-get update && apt-get install -y curl \\
    && npm install
RUN curl -fsSL https://example.com/install.sh | sh

FROM build AS test
RUN npm ci && npm install --global pnpm

FROM node:22-slim
COPY --from=build /app /app
CMD node server.js
`

const GOOD_DOCKERFILE = `FROM node:22-slim@sha256:abc AS build
WORKDIR /app
COPY . .
RUN npm ci && apt-get install -y --no-install-recommends curl

FROM gcr.io/distroless/nodejs22:nonroot
COPY --from=build /app /app
USER node
ENTRYPOINT ["node", "server.js"]
`

const COMPOSE = `version: "3.9"
services:
  db:
    image: postgres
    privileged: true
    environment:
      POSTGRES_PASSWORD: hunter2
      POSTGRES_USER: app
      OTHER_TOKEN: \${TOKEN}
      DB_PASSWORD_FILE: /run/secrets/db
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
  web:
    image: ghcr.io/acme/web:1.4.2
    network_mode: host
    environment:
      - SECRET_KEY=topsecret
`

describe('Dockerfile and Compose checks', () => {
  const rules = (root: string, policy = defaultPolicy()): string[] =>
    checkDocker({ root, policy }).map(
      finding => `${finding.file}:${finding.line} ${finding.rule.slice('pawl/'.length)}`
    )

  it('knows which files to read', () => {
    expect(
      ['Dockerfile', 'api/Dockerfile.prod', 'web.dockerfile', 'compose.yml', 'docker-compose.dev.yaml'].every(
        isDockerFile
      )
    ).toBe(true)
    expect(['src/Dockerfile.ts', 'docs/compose.md', 'decompose.yml'].some(isDockerFile)).toBe(false)
  })

  it('finds what is wrong in a Dockerfile, once each, at the right line', () => {
    const root = project({ Dockerfile: DOCKERFILE })

    expect(rules(root)).toEqual([
      'Dockerfile:1 docker-pin-image',
      'Dockerfile:2 docker-workdir-absolute',
      'Dockerfile:3 docker-no-secrets',
      'Dockerfile:5 docker-prefer-copy',
      'Dockerfile:7 docker-apt-no-recommends',
      'Dockerfile:7 docker-npm-ci',
      'Dockerfile:9 docker-no-curl-pipe',
      'Dockerfile:16 docker-exec-form',
      'Dockerfile:14 docker-no-root'
    ])
  })

  it('stays quiet on a Dockerfile that is fine', () => {
    expect(rules(project({ Dockerfile: GOOD_DOCKERFILE }))).toEqual([])
  })

  it('skips what a heredoc holds, and nothing after it', () => {
    const root = project({
      Dockerfile: [
        'FROM node:22-slim',
        'RUN <<EOF',
        'sudo apt-get install -y curl',
        'MAINTAINER nobody',
        'EOF',
        'COPY <<-"FIRST" <<SECOND /config/',
        'CMD not an instruction',
        'FIRST',
        'WORKDIR also/not/one',
        'SECOND',
        'MAINTAINER someone',
        'USER node',
        'CMD ["node", "server.js"]',
        ''
      ].join('\n')
    })

    expect(rules(root)).toEqual(['Dockerfile:11 docker-no-maintainer'])
  })

  it('does not take a here-string or a shift for a heredoc', () => {
    const root = project({
      Dockerfile: [
        'FROM node:22-slim',
        'SHELL ["/bin/bash", "-c"]',
        'RUN grep -q ready <<< "ready"',
        'RUN echo $(( 1 << 4 )) && echo "a << b"',
        'ENV NOTE="see <<EOF in the docs"',
        'MAINTAINER someone',
        'USER node',
        'CMD ["node", "server.js"]',
        ''
      ].join('\n')
    })

    // Every line after them is still read: the MAINTAINER is found and the USER counts.
    expect(rules(root)).toEqual(['Dockerfile:6 docker-no-maintainer'])
  })

  it('finds what is wrong in a Compose file, and leaves variable references and secret files alone', () => {
    const root = project({ 'compose.yml': COMPOSE })

    expect(rules(root)).toEqual([
      'compose.yml:1 compose-no-version',
      'compose.yml:4 compose-pin-image',
      'compose.yml:5 compose-no-privileged',
      'compose.yml:7 compose-no-secrets',
      'compose.yml:12 compose-no-docker-socket',
      'compose.yml:15 compose-no-host-network',
      'compose.yml:17 compose-no-secrets'
    ])
  })

  it('follows the policy: a level per check, and the ignore list', () => {
    const root = project({ Dockerfile: 'FROM node\nUSER node\n', 'vendor/Dockerfile': 'FROM node\n' })
    const policy = mergeLayers([
      { source: 'repo', input: { rules: { 'pawl/docker-pin-image': 'error' }, ignore: ['vendor/**'] } }
    ])
    const findings = checkDocker({ root, policy })

    expect(findings.map(finding => [finding.file, finding.severity])).toEqual([['Dockerfile', 'error']])
    expect(
      checkDocker({
        root,
        policy: mergeLayers([{ source: 'repo', input: { rules: { 'pawl/docker-pin-image': 'off' } } }])
      }).filter(finding => finding.file === 'Dockerfile')
    ).toEqual([])
    expect(new Set(DOCKER_RULES.map(def => def.name)).size).toBe(DOCKER_RULES.length)
  })
})

describe('workspace tools and agents', () => {
  it('makes check and fix uncached Nx targets on the root project', async () => {
    const root = project({ 'package.json': { name: 'mono', private: true, workspaces: ['apps/*'] }, 'nx.json': {} })
    const plan = await planInit({ root, install: false, editor: false })

    applyPlan(plan)

    const { readFileSync } = await import('node:fs')
    const manifest = JSON.parse(readFileSync(`${root}/package.json`, 'utf8')) as { nx: unknown; scripts: unknown }

    expect(manifest.scripts).toEqual({ check: 'pawl check', fix: 'pawl fix' })
    expect(manifest.nx).toEqual({ targets: { check: { cache: false }, fix: { cache: false } } })
    expect((await planInit({ root, install: false, editor: false })).actions.map(action => action.path)).not.toContain(
      'package.json'
    )
  })

  it('adds a Cursor hook only where Cursor is already used', async () => {
    const plain = project({ 'package.json': { name: 'a' } })
    const cursor = project({ 'package.json': { name: 'b' }, '.cursor/rules/x.mdc': 'x' })
    const paths = async (root: string) =>
      (await planInit({ root, install: false, editor: false, agents: true })).actions.map(action => action.path)

    expect(await paths(plain)).not.toContain('.cursor/hooks.json')
    expect(await paths(cursor)).toContain('.cursor/hooks.json')

    applyPlan(await planInit({ root: cursor, install: false, editor: false, agents: true }))

    const { readFileSync } = await import('node:fs')

    expect(JSON.parse(readFileSync(`${cursor}/.cursor/hooks.json`, 'utf8'))).toEqual({
      version: 1,
      hooks: {
        afterFileEdit: [{ command: 'npx --no pawl fix --hook' }],
        stop: [{ command: 'npx --no pawl check --hook' }]
      }
    })
  })
})
