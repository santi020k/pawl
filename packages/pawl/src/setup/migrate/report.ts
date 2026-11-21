/** What `pawl migrate` tells people: the lines it prints, and the report it writes. */

import { plural } from '../../utils/text.ts'
import { type MigratePlan } from './plan.ts'
import { rank } from './read.ts'

export const reportFile = (plan: Omit<MigratePlan, 'actions'>, backup: string | undefined): string => {
  const list = (items: readonly string[]): string =>
    items.length > 0 ? items.map(item => `- \`${item}\``).join('\n') : 'None.'
  const lines = [
    '# Migration to pawl',
    '',
    `Read from \`${plan.source}\`, comparing ${plural(plan.samples.length, 'file')}: ${plan.samples.map(file => `\`${file}\``).join(', ')}.`,
    ...(backup
      ? ['', `The old config is kept as \`${backup}\`. Delete it, and this file, when you are happy with the result.`]
      : []),
    '',
    '## Summary',
    '',
    `- ${plural(plan.total, 'rule')} on in the old config.`,
    `- ${plan.same} already at the same level in the pawl standard and its packs.`,
    `- ${plan.changed.length} carried into the policy because the old level differs.`,
    `- ${plan.formatting.length} formatting rules, now done by the formatter.`,
    `- ${plan.importSorting.length} import ordering rules, now done by import sorting.`,
    `- ${plan.added.length} rules the pawl standard and its packs add. Their existing findings go into the baseline.`,
    '',
    '## Levels kept from the old config',
    '',
    'These are in `rules` in the policy file. Delete a line to take the standard level.',
    '',
    ...(plan.changed.length > 0
      ? [
          '| Rule | Standard | Kept |',
          '| --- | --- | --- |',
          ...plan.changed.map(change => `| \`${change.rule}\` | ${change.standard} | ${change.kept} |`)
        ]
      : ['None.']),
    '',
    '## Options Biome does not take',
    '',
    'The policy carries the options of these rules for ESLint and Oxlint. Where Biome is the linter, it enforces them with its own options.',
    '',
    list(plan.biomeOptions),
    '',
    '## Rules that cannot run yet',
    '',
    ...(plan.notEnforced.length > 0
      ? plan.notEnforced.map(item => `- \`${item.rule}\` needs ${item.needs}`)
      : ['None.']),
    '',
    '## Replaced by the formatter',
    '',
    list(plan.formatting),
    '',
    '## Replaced by import sorting',
    '',
    list(plan.importSorting),
    '',
    '## Added by the standard',
    '',
    list(plan.added),
    ''
  ]

  return lines.join('\n')
}

/** The lines `pawl migrate` prints before it asks to go ahead. */
export const describeMigration = (plan: MigratePlan): string[] => {
  const stricter = plan.changed.filter(change => rank(change.kept) > rank(change.standard)).length
  const rows: [number, string][] = [
    [plan.total, 'rules on in the old config'],
    [plan.same, 'already at the same level in the pawl standard and its packs'],
    [
      plan.changed.length,
      `kept at the old level (${stricter} stricter than the standard, ${plan.changed.length - stricter} looser)`
    ],
    [plan.formatting.length, 'formatting rules, now done by the formatter'],
    [plan.importSorting.length, 'import ordering rules, now done by import sorting'],
    [plan.added.length, 'rules the standard adds (their existing findings go to the baseline)']
  ]
  const width = Math.max(...rows.map(([count]) => String(count).length))
  const style = Object.entries(plan.policy.style ?? {}).map(([key, value]) => `${key}: ${String(value)}`)

  return [
    `Read   ${plan.source} (${plural(plan.samples.length, 'sample file')})`,
    '',
    ...rows.map(([count, text]) => `  ${String(count).padStart(width)}  ${text}`),
    '',
    ...(plan.packs.length > 0 ? [`Packs  ${plan.packs.join(', ')}`] : []),
    ...(style.length > 0 ? [`Style  ${style.join(', ')}`] : []),
    ...plan.actions.map(
      action => `${action.kind === 'create' ? 'Write ' : 'Update'} ${action.path}  (${action.summary})`
    )
  ]
}
