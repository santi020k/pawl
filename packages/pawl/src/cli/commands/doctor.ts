/** `pawl doctor`: the setup and the tool versions, for people or as JSON. */

import { EXIT_OK, EXIT_SETUP } from '../../check/result.ts'
import { type DoctorReport, type DoctorRow, doctor, doctorRows, formatDoctor } from '../../report/doctor.ts'
import { plural } from '../../utils/text.ts'
import { type Flags, outputFormat, UsageError } from '../args.ts'
import { type Terminal, terminal } from '../audience.ts'
import { out } from '../io.ts'
import { rail, spinner } from '../ui.ts'

const GROUPS: readonly { group: DoctorRow['group']; title: string }[] = [
  { group: 'project', title: 'This repo' },
  { group: 'tools', title: 'Tools' },
  { group: 'extras', title: 'Ratchet and guards' }
]

/** The doctor's report on the rail: a section for each part, a mark for each line, then the problems. */
export const printDoctor = (report: DoctorReport, term: Terminal): void => {
  const { style, sym } = term
  const ui = rail(term)
  const rows = doctorRows(report)
  const width = Math.max(...rows.map(entry => entry.label.length))
  const mark: Record<DoctorRow['state'], string> = {
    ok: style.accent(sym.tick),
    warn: style.yellow(sym.warning),
    error: style.red(sym.cross),
    info: style.dim(sym.dot)
  }

  ui.start(`${style.accentBadge(' pawl ')} doctor  ${style.dim(report.version)}`)

  for (const { group, title } of GROUPS) {
    const lines = rows
      .filter(entry => entry.group === group)
      .map(entry =>
        entry.label
          ? `${mark[entry.state]} ${style.bold(entry.label.padEnd(width))}  ${entry.value}`
          : `  ${' '.repeat(width)}  ${style.dim(entry.value)}`
      )

    if (lines.length > 0) ui.step(title, lines)
  }

  if (report.problems.length === 0) {
    ui.end(`${style.accent(sym.tick)} No problems found.`)

    return
  }

  for (const problem of report.problems) ui.error(problem)

  ui.end(
    `${plural(report.problems.length, 'problem')}. Fix ${report.problems.length === 1 ? 'it' : 'them'}, then run ${style.bold('pawl doctor')} again.`
  )
}

export const runDoctor = async (root: string, flags: Flags): Promise<number> => {
  const kind = outputFormat(flags)

  if (kind === 'agent' || kind === 'editor')
    throw new UsageError(`Unknown format "${kind}" for doctor. Use pretty or json.`)

  const term = terminal()

  if (kind === 'json' || !term.rich) {
    const report = await doctor(root)

    out(kind === 'json' ? JSON.stringify(report, null, 2) : formatDoctor(report))

    return report.problems.length > 0 ? EXIT_SETUP : EXIT_OK
  }

  const status = spinner(term, process.stdout, `Looking at the setup${term.sym.ellipsis}`)
  let report: DoctorReport

  try {
    report = await doctor(root)
  } finally {
    status.clear()
  }

  printDoctor(report, term)

  return report.problems.length > 0 ? EXIT_SETUP : EXIT_OK
}
