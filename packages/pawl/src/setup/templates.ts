/** The files and settings pawl writes into a project, as text it can compare and update. */

import { type PackageManager } from '../project/detect.ts'
import { type PolicyInput } from '../types.ts'
import { isRecord, type JsonRecord } from '../utils/json.ts'
import { PACKAGE_NAME } from '../version.ts'

/** The ESLint config pawl writes. The root is the config file's folder, wherever ESLint is started from. */
export const ESLINT_CONFIG = `import { eslint } from '${PACKAGE_NAME}'

export default eslint({ root: import.meta.dirname })
`

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/

const INLINE_WIDTH = 80

/** Write a value as source code in the pawl style: single quotes, no trailing commas, two spaces. */
const toSource = (value: unknown, depth: number): string => {
  const pad = '  '.repeat(depth + 1)
  const close = '  '.repeat(depth)

  if (Array.isArray(value)) {
    const items = value.map(item => toSource(item, depth + 1))
    const inline = `[${items.join(', ')}]`

    return inline.length <= INLINE_WIDTH ? inline : `[\n${items.map(item => pad + item).join(',\n')}\n${close}]`
  }

  if (isRecord(value)) {
    const entries = Object.entries(value).map(
      ([key, item]) => `${pad}${IDENTIFIER.test(key) ? key : toSource(key, 0)}: ${toSource(item, depth + 1)}`
    )

    return entries.length > 0 ? `{\n${entries.join(',\n')}\n${close}}` : '{}'
  }

  return typeof value === 'string' ? `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'` : String(value)
}

/** The source of a policy file for a policy. */
export const policyFile = (policy: PolicyInput): string =>
  `import { definePolicy } from '${PACKAGE_NAME}'\n\nexport default definePolicy(${toSource(policy, 0)})\n`

/** The actions the workflow uses, pinned by commit so a moved tag cannot change what runs. */
const ACTIONS = {
  checkout: 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1',
  setupNode: 'actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0',
  uploadArtifact: 'actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2',
  setupBun: 'oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0'
}

/** The step that makes each package manager available on a GitHub runner. */
const WORKFLOW_SETUP: Record<PackageManager, string> = {
  npm: '',
  bun: `      - uses: ${ACTIONS.setupBun}\n`,
  pnpm: '      - run: npm install --global corepack@latest && corepack enable\n',
  yarn: '      - run: npm install --global corepack@latest && corepack enable\n'
}

/**
 * The GitHub workflow: the check on every pull request, then the doctor's report as an artifact,
 * which shows the tool versions and any drift even when the check fails.
 */
export const workflowFile = (manager: PackageManager): string => {
  const install = manager === 'npm' ? 'npm ci' : `${manager} install --frozen-lockfile`
  const setup = WORKFLOW_SETUP[manager]

  return `name: pawl

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: ${ACTIONS.checkout}
      - uses: ${ACTIONS.setupNode}
        with:
          node-version: 22
${setup}      - run: ${install}
      - run: npx pawl check --ci
      - name: Check the setup and the tool versions
        if: always()
        run: npx pawl doctor --format json > pawl-doctor.json
      - name: Upload the doctor report
        if: always()
        uses: ${ACTIONS.uploadArtifact}
        with:
          name: pawl-doctor
          path: pawl-doctor.json
          if-no-files-found: warn
`
}

export const EDITOR_SETTINGS: JsonRecord = {
  'editor.defaultFormatter': 'biomejs.biome',
  'editor.formatOnSave': true,
  'editor.codeActionsOnSave': {
    'source.fixAll.biome': 'explicit',
    'source.organizeImports.biome': 'explicit'
  }
}

export const AGENTS_START = '<!-- pawl:start -->'

export const AGENTS_END = '<!-- pawl:end -->'

export const AGENTS_BLOCK = `${AGENTS_START}
## Code quality

This repo uses pawl. After editing code, run:

    npx pawl check --changed --format agent

It prints one JSON line per problem, each with a \`fix\`. No output means there is nothing to do.
Run \`npx pawl fix\` to apply formatting and safe fixes.

Do not silence a problem with a disable comment (\`biome-ignore\`, \`eslint-disable\`, \`@ts-ignore\`).
New ones fail the check. Fix the code instead.
${AGENTS_END}
`

export const HOOK_COMMAND = 'npx pawl check --changed'

export const PRETTIER_EDITOR_SETTINGS: JsonRecord = {
  'editor.defaultFormatter': 'esbenp.prettier-vscode',
  'editor.formatOnSave': true
}
