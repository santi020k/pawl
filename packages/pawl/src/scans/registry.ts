import { listFiles } from '../project/files.ts'
import { type Finding } from '../types.ts'
import { docker } from './docker.ts'
import { hiddenScan } from './hidden.ts'
import { markdown } from './markdown.ts'
import { type OwnRule, runScan, type Scan, type ScanOptions } from './scan.ts'

/** Every scan pawl runs itself. */
export const SCANS: readonly Scan[] = [docker, markdown, hiddenScan]

/** True when one of pawl's own scans reads this file even in the folders the default ignores skip. */
export const scansReadIgnored = (file: string): boolean => SCANS.some(scan => scan.readsIgnored?.(file) === true)

/** Run every scan. */
export const runScans = (options: ScanOptions): Finding[] => {
  const projectFiles = options.files === undefined ? (options.projectFiles ?? listFiles(options.root)) : undefined
  const runOptions: ScanOptions = projectFiles ? { ...options, projectFiles } : options

  return SCANS.flatMap(scan => runScan(scan, runOptions))
}

/** One of pawl's own rules by name, with or without `pawl/`, and the scan that has it. */
export const findOwnRule = (name: string): { rule: OwnRule; scan: Scan } | undefined => {
  const wanted = name.startsWith('pawl/') ? name : `pawl/${name}`

  for (const scan of SCANS) {
    const rule = scan.rules.find(candidate => candidate.name === wanted)

    if (rule) return { rule, scan }
  }

  return undefined
}
