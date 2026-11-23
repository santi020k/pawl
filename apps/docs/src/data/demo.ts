/**
 * Terminal sessions shown on the landing page.
 *
 * These are real runs of the pawl CLI on a small demo repo (an npm project with two
 * TypeScript files, set up with `pawl init`). Re-run them after a change to the output format.
 */

export type Tone = 'prompt' | 'command' | 'path' | 'error' | 'warn' | 'rule' | 'muted' | 'ok' | 'plain'

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
    caption: 'An agent added billing.ts. The six findings the repo already had are allowed; the four new ones are not.',
    lines: [
      [
        ['$ ', 'prompt'],
        ['pawl check', 'command']
      ],
      [
        ['src/billing.ts:1:20', 'path'],
        ['  error  ', 'error'],
        ['biome   ', 'muted'],
        ['correctness/noUndeclaredDependencies', 'rule']
      ],
      [["  Dependency stripe-lite isn't specified in package.json."]],
      blank,
      [
        ['src/billing.ts:3:32', 'path'],
        ['  warn   ', 'warn'],
        ['biome   ', 'muted'],
        ['suspicious/noExplicitAny', 'rule']
      ],
      [['  Unexpected any. Specify a different type.']],
      blank,
      [
        ['src/billing.ts:4:1', 'path'],
        ['   error  ', 'error'],
        ['pawl    ', 'muted'],
        ['pawl/no-new-disable', 'rule']
      ],
      [['  New "biome-ignore" comment. Fix the finding instead of switching the check off.']],
      blank,
      [
        ['src/billing.ts:6:14', 'path'],
        ['  error  ', 'error'],
        ['biome   ', 'muted'],
        ['suspicious/noDoubleEquals', 'rule']
      ],
      [['  Using == may be unsafe if you are relying on type coercion.']],
      blank,
      [['3 errors, 1 warning.', 'error']],
      [['6 existing findings allowed by the baseline.', 'muted']]
    ]
  },
  {
    id: 'agent',
    label: '--format agent',
    caption: 'The same run for a coding agent: one JSON line per finding, errors first, each with the fix.',
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
    id: 'improve',
    label: 'after a fix',
    caption: 'Someone cleaned up legacy.ts. The check passes and says so; one command locks the gain in.',
    lines: [
      [
        ['$ ', 'prompt'],
        ['pawl check', 'command']
      ],
      [['No new findings.', 'ok']],
      [['2 existing findings allowed by the baseline.', 'muted']],
      [['The code has fewer findings than the baseline allows. Run "pawl baseline" to lock that in.']],
      blank,
      [
        ['$ ', 'prompt'],
        ['pawl baseline', 'command']
      ],
      [['Baseline updated: 2 findings recorded in .pawl/baseline.json.', 'ok']]
    ]
  }
]

/** `pawl init` on the demo repo, accepting the plan up front. Biome was already installed, hence --no-install. */
export const initRun: readonly Line[] = [
  [
    ['$ ', 'prompt'],
    ['npx @santi020k/pawl init --yes --no-install', 'command']
  ],
  [['Detected: ', 'muted'], ['JavaScript, npm']],
  [['Lint:     ', 'muted'], ['Biome']],
  [['Format:   ', 'muted'], ['Biome']],
  blank,
  [
    ['Write  ', 'ok'],
    ['biome.json', 'path'],
    ['  (the pawl standard for Biome)', 'muted']
  ],
  [
    ['Update ', 'ok'],
    ['package.json', 'path'],
    ['  (scripts "check" and "fix")', 'muted']
  ],
  [
    ['Write  ', 'ok'],
    ['.vscode/settings.json', 'path'],
    ['  (format on save with Biome)', 'muted']
  ],
  [
    ['Write  ', 'ok'],
    ['.vscode/extensions.json', 'path'],
    ['  (recommend the Biome extension)', 'muted']
  ],
  [['Baseline: 6 existing findings recorded in .pawl/baseline.json. New ones will fail the check.']],
  blank,
  [['Done. Run "pawl check" to check the code and "pawl fix" to fix it.', 'ok']]
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
