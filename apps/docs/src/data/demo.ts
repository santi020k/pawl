/**
 * Terminal sessions shown on the landing page.
 *
 * These are real runs of the pawl CLI on a small demo repo (an npm project with two
 * TypeScript files, set up with `pawl init`). Re-run them after a change to the output format.
 */

/** The colors of a run. `pass`, `fail` and `caution` are the badges of a check's summary. */
export type Tone =
  | 'prompt'
  | 'command'
  | 'path'
  | 'error'
  | 'warn'
  | 'rule'
  | 'muted'
  | 'ok'
  | 'plain'
  | 'pass'
  | 'fail'
  | 'caution'

export type Segment = readonly [text: string, tone?: Tone]

export type Line = readonly Segment[]

export interface Session {
  readonly id: string
  readonly label: string
  readonly caption: string
  readonly lines: readonly Line[]
}

const blank: Line = []

export const sessions: readonly Session[] = [
  {
    id: 'check',
    label: 'pawl check',
    caption:
      'An agent added billing.ts. The six findings the repo already had are allowed; the four new ones fail, each with the line it points at and how to fix it.',
    lines: [
      [
        ['$ ', 'prompt'],
        ['pawl check', 'command']
      ],
      [
        ['✖', 'error'],
        [' '],
        ['error', 'error'],
        ['  '],
        ['src/billing.ts:1:20', 'path'],
        ['  '],
        ['correctness/noUndeclaredDependencies', 'rule'],
        [' '],
        ['biome', 'muted']
      ],
      [["  Dependency stripe-lite isn't specified in package.json."]],
      [['    '], ['1', 'muted'], [' '], ['│', 'muted'], [" import Stripe from 'stripe-lite'"]],
      [['      '], ['│', 'muted'], ['                    '], ['^^^^^^^^^^^^^', 'error']],
      [['  '], ['→', 'ok'], [' Check that the package exists and is the one you mean, then add it to package.json.']],
      blank,
      [
        ['▲', 'warn'],
        [' '],
        ['warn ', 'warn'],
        ['  '],
        ['src/billing.ts:3:32', 'path'],
        ['  '],
        ['suspicious/noExplicitAny', 'rule'],
        [' '],
        ['biome', 'muted']
      ],
      [['  Unexpected any. Specify a different type.']],
      [['    '], ['3', 'muted'], [' '], ['│', 'muted'], [' export const charge = (amount: any) => {']],
      [['      '], ['│', 'muted'], ['                                '], ['^^^', 'warn']],
      [['  '], ['→', 'ok'], [' Use a specific type, or unknown and narrow it.']],
      blank,
      [
        ['✖', 'error'],
        [' '],
        ['error', 'error'],
        ['  '],
        ['src/billing.ts:4:1', 'path'],
        ['  '],
        ['pawl/no-new-disable', 'rule'],
        [' '],
        ['pawl', 'muted']
      ],
      [['  New "biome-ignore" comment. Fix the finding instead of switching the check off.']],
      // The comment is split in two so pawl's own check does not count it as a disable comment of this file.
      [
        ['    '],
        ['4', 'muted'],
        [' '],
        ['│', 'muted'],
        ['   // biome'],
        ['-ignore lint/suspicious/noConsole: debugging']
      ],
      [['      '], ['│', 'muted'], ['   '], ['^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^', 'error']],
      [['  '], ['→', 'ok'], [' Remove the disable comment and fix the finding it hides.']],
      blank,
      [
        ['✖', 'error'],
        [' '],
        ['error', 'error'],
        ['  '],
        ['src/billing.ts:6:14', 'path'],
        ['  '],
        ['suspicious/noDoubleEquals', 'rule'],
        [' '],
        ['biome', 'muted']
      ],
      [['  Using == may be unsafe if you are relying on type coercion.']],
      [['    '], ['6', 'muted'], [' '], ['│', 'muted'], ['   if (amount == 0) return null']],
      [['      '], ['│', 'muted'], ['              '], ['^^', 'error']],
      blank,
      [[' FAIL ', 'fail'], [' '], ['3 errors', 'error'], [', ', 'muted'], ['1 warning', 'warn']],
      [['  '], ['6 existing findings allowed by the baseline.', 'muted']],
      [['  '], ['Checked with Biome in 117 ms.', 'muted']]
    ]
  },
  {
    id: 'agent',
    label: '--format agent',
    caption:
      'The same run for a coding agent: one JSON line per finding, errors first, each with the fix. Pawl prints this on its own when an agent runs it.',
    lines: [
      [
        ['$ ', 'prompt'],
        ['pawl check --changed --format agent', 'command']
      ],
      [
        ['{"file":"src/billing.ts","line":1,"rule":"biome:correctness/noUndeclaredDependencies",', 'plain'],
        ['"message":"Dependency stripe-lite isn\'t specified in package.json.",', 'muted'],
        ['"fix":"Check that the package exists and is the one you mean, then add it to package.json."}', 'ok']
      ],
      [
        ['{"file":"src/billing.ts","line":4,"rule":"pawl/no-new-disable",', 'plain'],
        ['"message":"New \\"biome-ignore\\" comment. Fix the finding instead of switching the check off.",', 'muted'],
        ['"fix":"Remove the disable comment and fix the finding it hides."}', 'ok']
      ],
      [
        ['{"file":"src/billing.ts","line":6,"rule":"biome:suspicious/noDoubleEquals",', 'plain'],
        ['"message":"Using == may be unsafe if you are relying on type coercion."}', 'muted']
      ],
      [
        ['{"file":"src/billing.ts","line":3,"rule":"biome:suspicious/noExplicitAny",', 'plain'],
        ['"message":"Unexpected any. Specify a different type.",', 'muted'],
        ['"fix":"Use a specific type, or unknown and narrow it."}', 'ok']
      ]
    ]
  },
  {
    id: 'editor',
    label: '--format editor',
    caption:
      'The same run for a code editor: the lines compilers print, which VS Code reads into its Problems panel through the task pawl init writes.',
    lines: [
      [
        ['$ ', 'prompt'],
        ['pawl check --format editor', 'command']
      ],
      [
        ['src/billing.ts:1:20', 'path'],
        [': '],
        ['error', 'error'],
        [": Dependency stripe-lite isn't specified in package.json. "],
        ['[biome:correctness/noUndeclaredDependencies]', 'rule']
      ],
      [
        ['src/billing.ts:3:32', 'path'],
        [': '],
        ['warning', 'warn'],
        [': Unexpected any. Specify a different type. '],
        ['[biome:suspicious/noExplicitAny]', 'rule']
      ],
      [
        ['src/billing.ts:4:1', 'path'],
        [': '],
        ['error', 'error'],
        [': New "biome-ignore" comment. Fix the finding instead of switching the check off. '],
        ['[pawl/no-new-disable]', 'rule']
      ],
      [
        ['src/billing.ts:6:14', 'path'],
        [': '],
        ['error', 'error'],
        [': Using == may be unsafe if you are relying on type coercion. '],
        ['[biome:suspicious/noDoubleEquals]', 'rule']
      ]
    ]
  },
  {
    id: 'improve',
    label: 'after a fix',
    caption: 'Someone cleaned up legacy.ts. The check passes and says so; one command locks the gain in.',
    lines: [
      [
        ['$ ', 'prompt'],
        ['pawl check', 'command']
      ],
      [[' PASS ', 'pass'], [' '], ['No new findings.', 'command']],
      [['  '], ['2 existing findings allowed by the baseline.', 'muted']],
      [
        ['  '],
        ['→', 'ok'],
        [' The code has fewer findings than the baseline allows. Run '],
        ['pawl baseline', 'command'],
        [' to lock that in.']
      ],
      [['  '], ['Checked with Biome in 122 ms.', 'muted']],
      blank,
      [
        ['$ ', 'prompt'],
        ['pawl baseline', 'command']
      ],
      [['✔', 'ok'], [' Baseline updated: 2 findings recorded in .pawl/baseline.json.']]
    ]
  }
]

/** `pawl init` on the demo repo, accepting the plan up front. Biome was already installed, hence --no-install. */
export const initRun: readonly Line[] = [
  [
    ['$ ', 'prompt'],
    ['npx @santi020k/pawl init --yes --no-install', 'command']
  ],
  [['┌', 'muted'], ['  '], [' pawl ', 'pass'], [' init']],
  [['│', 'muted']],
  [['●', 'rule'], ['  Detected']],
  [['│', 'muted'], ['  JavaScript, npm']],
  [['│', 'muted']],
  [['◇', 'ok'], ['  The plan']],
  [['│', 'muted'], ['  '], ['Lint  ', 'muted'], ['  '], ['Biome', 'command']],
  [['│', 'muted'], ['  '], ['Format', 'muted'], ['  '], ['Biome', 'command']],
  [['│', 'muted']],
  [['│', 'muted'], ['  '], ['+', 'ok'], [' biome.json               '], ['the pawl standard for Biome', 'muted']],
  [
    ['│', 'muted'],
    ['  '],
    ['~', 'warn'],
    [' package.json             '],
    ['scripts "check" and "fix", @santi020k/pawl,', 'muted']
  ],
  [['│', 'muted'], ['                             '], ['@biomejs/biome in devDependencies', 'muted']],
  [['│', 'muted'], ['  '], ['+', 'ok'], [' .vscode/settings.json    '], ['format on save with Biome', 'muted']],
  [['│', 'muted'], ['  '], ['+', 'ok'], [' .vscode/extensions.json  '], ['recommend the Biome extension', 'muted']],
  [
    ['│', 'muted'],
    ['  '],
    ['+', 'ok'],
    [' .vscode/tasks.json       '],
    ['tasks that put findings in the Problems panel', 'muted']
  ],
  [['│', 'muted']],
  [['◇', 'ok'], ['  Wrote 5 files']],
  [['│', 'muted']],
  [['◇', 'ok'], ['  Baseline: 6 existing findings recorded in .pawl/baseline.json. New ones will fail the check.']],
  [['│', 'muted']],
  [
    ['└', 'muted'],
    ['  Done. Run '],
    ['pawl check', 'command'],
    [' to check the code and '],
    ['pawl fix', 'command'],
    [' to fix it.']
  ]
]

/** `pawl explain eqeqeq`: one rule name, and what enforces it in each engine. */
export const explain: readonly Line[] = [
  [
    ['$ ', 'prompt'],
    ['pawl explain eqeqeq', 'command']
  ],
  [['eqeqeq', 'rule']],
  [['  Use === and !==.']],
  blank,
  [
    ['  Level here:  ', 'muted'],
    ['error', 'error'],
    [' (default standard)', 'muted']
  ],
  [
    ['  Biome:       ', 'muted'],
    ['suspicious/noDoubleEquals', 'plain'],
    ['  https://biomejs.dev/linter/rules/no-double-equals', 'muted']
  ],
  [
    ['  Oxlint:      ', 'muted'],
    ['eqeqeq', 'plain']
  ],
  [
    ['  ESLint:      ', 'muted'],
    ['eqeqeq', 'plain']
  ]
]
