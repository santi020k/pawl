/** `pawl doctor`: the setup and the tool versions, for people or as JSON. */

import { EXIT_OK, EXIT_SETUP } from '../../check/result.ts'
import { doctor, formatDoctor } from '../../report/doctor.ts'
import { type Flags, outputFormat, UsageError } from '../args.ts'
import { out } from '../io.ts'

export const runDoctor = async (root: string, flags: Flags): Promise<number> => {
  const kind = outputFormat(flags)

  if (kind === 'agent') throw new UsageError('Unknown format "agent" for doctor. Use pretty or json.')

  const report = await doctor(root)

  out(kind === 'json' ? JSON.stringify(report, null, 2) : formatDoctor(report))

  return report.problems.length > 0 ? EXIT_SETUP : EXIT_OK
}
