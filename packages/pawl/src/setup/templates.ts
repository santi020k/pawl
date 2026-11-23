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

/**
 * The problem matcher of the VS Code tasks: it reads the lines of `--format editor`, such as
 * `src/a.ts:3:7: error: Unexpected debugger. [biome:suspicious/noDebugger]`, into the Problems panel.
 */
export const PROBLEM_MATCHER: JsonRecord = {
  owner: 'pawl',
  source: 'pawl',
  // VS Code's own variable, put together so it does not read as a template string left unfilled.
  fileLocation: ['relative', ['$', '{workspaceFolder}'].join('')],
  pattern: {
    regexp: '^(.+?):(\\d+):(\\d+): (error|warning): (.*) \\[([^\\]]+)\\]$',
    file: 1,
    line: 2,
    column: 3,
    severity: 4,
    message: 5,
    code: 6
  }
}

/** VS Code tasks that run pawl and put what it finds in the Problems panel. */
export const VSCODE_TASKS: readonly JsonRecord[] = [
  {
    label: 'pawl: check',
    detail: 'Lint and check formatting; the findings go to the Problems panel',
    type: 'shell',
    command: 'npx pawl check --format editor',
    problemMatcher: PROBLEM_MATCHER,
    presentation: { clear: true }
  },
  {
    label: 'pawl: fix',
    detail: 'Apply safe fixes and format; what is left goes to the Problems panel',
    type: 'shell',
    command: 'npx pawl fix --format editor',
    problemMatcher: PROBLEM_MATCHER,
    presentation: { clear: true }
  }
]

/**
 * Zed tasks. Zed does not read diagnostics from a task, so they run pawl's view for people in
 * Zed's terminal, where each file:line:col opens the file. Saving first means pawl sees what the
 * editor shows.
 */
export const ZED_TASKS: readonly JsonRecord[] = [
  { label: 'pawl: check', command: 'npx pawl check', use_new_terminal: false, reveal: 'always', save: 'all' },
  { label: 'pawl: fix', command: 'npx pawl fix', use_new_terminal: false, reveal: 'always', save: 'all' }
]

export const AGENTS_START = '<!-- pawl:start -->'

export const AGENTS_END = '<!-- pawl:end -->'

export const AGENTS_BLOCK = `${AGENTS_START}
## Code quality

This repo uses pawl. After editing code, run:

    npx pawl check --changed --format agent

It prints one JSON line per problem, each with a \`fix\`. No output means there is nothing to do.
Run \`npx pawl fix\` to apply formatting and safe fixes.

Do not silence a problem with a disable comment (\`biome-ignore\`, \`eslint-disable\`, \`@ts-ignore\`).
New ones fail the check. Fix the code instead. Do not run \`pawl baseline\` to make findings go
away either: it accepts them as they are, and that is for a person to decide.
${AGENTS_END}
`

/** What a coding agent's post-edit hook runs: fix the files it edited, then tell it what is left. */
export const AGENT_HOOK_COMMAND = 'npx pawl fix --hook'

/**
 * Hook commands earlier versions of pawl wrote. Claude Code never saw the first one's output,
 * and the second fixed every changed file after each edit. Init swaps them for the one above.
 */
export const OLD_AGENT_HOOK_COMMANDS = ['npx pawl check --changed --format agent', 'npx pawl fix --changed']

/** In the skill pawl writes. A copy without it is someone's own, and init leaves it alone. */
export const SKILL_MARKER =
  '<!-- Written by "pawl init", which updates it. Delete this line to keep your own version. -->'

/** The skill pawl writes for coding agents, in the Agent Skills format that Claude Code, Codex and Copilot read. */
export const SKILL_FILE = `---
name: pawl
description: Check, fix and explain lint and format findings with pawl, this repo's code quality tool. Use after editing code, before committing, when a pawl hook or CI reports problems, or when asked why a rule fires.
---

${SKILL_MARKER}

# pawl

This repo checks its code with pawl (https://pawl.santi020k.com). Pawl runs the repo's own linter and formatter against one shared standard, and keeps a baseline of the findings that already existed, so only new ones fail.

## After you edit code

1. Run \`npx pawl fix --changed\` to apply the safe fixes and format the files you changed.
2. Run \`npx pawl check --changed --format agent\`.
3. No output means there is nothing to do. Otherwise each line is one JSON object with \`file\`, \`line\`, \`rule\` and \`message\`, and a \`fix\` when pawl knows one. Errors come first.
4. Fix every line in the code, then run the check again.

When a hook runs pawl after each of your edits, its message lists what is left in the files you just edited. Fix those before you move on.

## What a finding means

- \`npx pawl explain <rule>\` shows what a rule checks and its level in this repo. Give it the rule as the check printed it.
- A finding from one of pawl's guards (internal imports of a library, a legacy SDK, an API key in the code) says in its message what to do instead.

## Exit codes

- 0: nothing new.
- 1: new errors, or more new warnings than the limit allows.
- 2: a setup problem, so part of the check did not run. Read the message: it says what to run. Tell the user when it asks for a tool to be installed or upgraded, and run \`npx pawl doctor\` to see the whole setup.

## Do not

- Add a disable comment: \`biome-ignore\`, \`eslint-disable\`, \`oxlint-disable\`, \`@ts-ignore\`, \`@ts-expect-error\` or \`@ts-nocheck\`. A new one fails the check as \`pawl/no-new-disable\`.
- Run \`npx pawl baseline\`. It accepts every current finding as allowed, and only a person decides that.
- Edit \`.pawl/baseline.json\`, or loosen a rule in the policy (\`pawl.config.ts\` or \`pawl.config.json\`) or in an engine config such as \`biome.json\`, unless the user asks you to.

## Other commands

- \`npx pawl check\` checks the whole repo, and \`npx pawl check --since origin/main\` what the branch changed.
- \`npx pawl doctor\` checks the setup and the tool versions.
`

export const HOOK_COMMAND = 'npx pawl check --changed'

export const PRETTIER_EDITOR_SETTINGS: JsonRecord = {
  'editor.defaultFormatter': 'esbenp.prettier-vscode',
  'editor.formatOnSave': true
}
