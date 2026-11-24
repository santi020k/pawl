/**
 * The agent session the landing page replays: an agent writes a file, pawl's hook fixes what it
 * can and hands back the rest, the agent fixes the code, and the hook has nothing left to say.
 *
 * The problems, their positions and the timings come from a real run of `pawl fix --hook` on
 * the demo repo of `demo.ts`, with Claude Code's hook input. Re-run it after a change to the
 * standard or to the hook's output.
 */

export interface ReplayProblem {
  readonly line: number
  readonly column: number
  /** The rule as pawl prints it: the engine's own name, or pawl's. */
  readonly rule: string
  readonly severity: 'error' | 'warn'
  readonly message: string
}

export interface DiffLine {
  /** `-` removed, `+` added, ` ` kept, `…` lines left out. */
  readonly kind: '-' | '+' | ' ' | '…'
  readonly text: string
}

export const replay = {
  path: '~/acme/api',
  file: 'src/refunds.ts',
  prompt: 'Add a refund endpoint to the payments API',
  wrote: 10,
  hook: 'npx --no pawl fix --hook',
  /** The first hook run: it formatted the file, then found these. */
  firstMs: 195,
  problems: [
    {
      line: 3,
      column: 34,
      rule: 'suspicious/noExplicitAny',
      severity: 'warn',
      message: 'Unexpected any. Specify a different type.'
    },
    {
      line: 5,
      column: 1,
      rule: 'pawl/no-new-disable',
      severity: 'error',
      message: 'New "biome-ignore" comment. Fix the finding instead of switching the check off.'
    },
    {
      line: 7,
      column: 22,
      rule: 'suspicious/noDoubleEquals',
      severity: 'error',
      message: 'Using == may be unsafe if you are relying on type coercion.'
    },
    {
      line: 8,
      column: 44,
      rule: 'style/noNestedTernary',
      severity: 'warn',
      message: 'Do not nest ternary expressions.'
    }
  ] satisfies readonly ReplayProblem[],
  plan: 'Fixing all 4: typing the id, removing the debug log and the comment that hid it from the linter, using ===, and replacing the nested ternary with a table of fees.',
  diff: [
    { kind: '+', text: 'const fees = [' },
    { kind: '+', text: '  { over: 1000, fee: 10 },' },
    { kind: '+', text: '  { over: 100, fee: 5 }' },
    { kind: '+', text: ']' },
    { kind: '…', text: '' },
    { kind: '-', text: 'export async function refund(id: any) {' },
    { kind: '+', text: 'export async function refund(id: string) {' },
    { kind: ' ', text: '  const payment = await db.payments.find(id)' },
    // Split in two so pawl's own check does not count it as a disable comment of this file.
    { kind: '-', text: `  // biome${'-'}ignore lint/suspicious/noConsole: debugging` },
    { kind: '-', text: "  console.log('refund', payment)" },
    { kind: '-', text: "  if (payment.status == 'refunded') return null" },
    { kind: '+', text: "  if (payment.status === 'refunded') return null" },
    { kind: '-', text: '  const fee = payment.amount > 1000 ? 10 : payment.amount > 100 ? 5 : 0' },
    { kind: '+', text: '  const fee = fees.find(tier => payment.amount > tier.over)?.fee ?? 0' }
  ] satisfies readonly DiffLine[],
  /** The second hook run, with nothing left to report. */
  secondMs: 227,
  done: 'Done. refund() is typed, and it passes the check without a disable comment.',
  engine: 'Biome, with the pawl standard',
  baseline: '6 older findings allowed by the baseline'
} as const
