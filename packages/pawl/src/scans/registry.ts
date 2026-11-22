import { type Finding } from '../types.ts'
import { docker } from './docker.ts'
import { markdown } from './markdown.ts'
import { type OwnRule, runScan, type Scan, type ScanOptions } from './scan.ts'

/** Every scan pawl runs itself. */
export const SCANS: readonly Scan[] = [docker, markdown]

/** Run every scan. */
export const runScans = (options: ScanOptions): Finding[] => SCANS.flatMap(scan => runScan(scan, options))

/** One of pawl's own rules by name, with or without `pawl/`, and the scan that has it. */
export const findOwnRule = (name: string): { rule: OwnRule; scan: Scan } | undefined => {
  const wanted = name.startsWith('pawl/') ? name : `pawl/${name}`

  for (const scan of SCANS) {
    const rule = scan.rules.find(candidate => candidate.name === wanted)

    if (rule) return { rule, scan }
  }

  return undefined
}
