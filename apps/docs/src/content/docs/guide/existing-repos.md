---

title: Existing repos
description: "Bring an existing repo under pawl: adopt without a baseline, keep the exceptions a reviewer agreed to, and keep customized Biome scopes when pawl updates its own."
---

Pawl starts from what a repo already has. This page covers adopting it without accepting the findings that are there, keeping the exceptions that are there on purpose, and how pawl updates the Biome scopes it writes without touching the ones you changed.

## Adopt without a baseline

By default, `pawl init` records existing findings in a baseline. To adopt Pawl
without accepting those findings, use `--no-baseline`:

```sh
pawl init --yes --no-baseline --dry-run
pawl init --yes --no-baseline
pawl check
```

The dry run describes the configuration writes and confirms that no baseline
will be recorded. The second command installs the selected tools and writes the
configuration. It does not accept existing findings. Run `pawl check` to validate
the source: existing errors still fail, and warnings follow the policy's warning
limit. Setup success alone does not mean the source passes.

For a shared standard, create the policy before running init:

```ts
import { definePolicy } from '@santi020k/pawl'

export default definePolicy({ extends: '@santi020k/pawl-policy' })
```

Install the shared policy package in the project before using it. Init retains
that policy and its locked rule floors; `--no-baseline` does not loosen rules or
change ignores. Keep existing framework validation and semantic ESLint checks
that the selected engine does not replace.

The option also works with `pawl migrate --no-baseline`. Migration's normal
configuration-preservation checks still apply.

### Existing baselines

`--no-baseline` prevents recording a new baseline. It does not delete, rewrite
or bypass an existing `.pawl/baseline.json`. Init reports when that file already
exists, and subsequent checks still apply it. Review existing accepted findings
before deciding to remove a baseline; this option does not silently undo that
previous decision.

### Library use

Pass `baseline: false` to `planInit`. The returned plan carries that choice, and
`recordBaseline(root, plan)` returns without writing when it is disabled. The
planner itself never writes files.

## Reviewed exceptions

### Operations that must remain serial

`no-await-in-loop` is advice about independent work. Browser interactions, writes
to an ordered output stream, provider polling and pagination whose next cursor
comes from the previous response must remain serial. Converting these operations
to `Promise.all` can change behavior or corrupt output.

Keep the ordering, document why the operation depends on the previous result, and
scope an exception to the responsible file in the policy. Test the call order,
failure handling and cancellation before accepting the exception. A locked rule
requires a decision in its owning shared policy; local exceptions cannot lower it.

```ts
export default {
  overrides: [
    {
      files: ['/scripts/poll-deployment.ts'],
      rules: { 'no-await-in-loop': 'off' }
    }
  ]
}
```

### Accessible CSS and generated themes

Check cascade layers and specificity before adding `!important`. Some reduced-motion
styles and overrides of generated theme declarations need it to win the cascade.
Do not remove those declarations just to clear a finding. Capture the relevant
rendered state and test reduced-motion behavior or computed styles first.

Use the exact stylesheet scope for a reviewed
`biome:complexity/noImportantStyles` exception. Keep the reason beside the policy
entry, and keep other stylesheets checked. Pawl does not automatically remove
these safeguards or add suppression comments, which are subject to its ratchet.

## Generated Biome scopes

When Pawl creates a Biome configuration, it records the exact generated override
array in `.pawl/biome-overrides.json` as a versioned SHA-256 fingerprint. Array
order, rule options and file patterns all participate. Keep this metadata with
the configuration when sharing the project; it is ownership evidence, not a lint
cache. It contains no source contents.

### Safe updates

`pawl sync --dry-run` lists the configuration update, recoverable backup and
ownership metadata write. Sync can replace a generated array only when the current
array matches its recorded fingerprint. It preserves unrelated settings and
removes obsolete generated scopes when the policy no longer requests them.

Before updating owned configuration, Pawl saves its exact previous bytes under
`.pawl/backups/biome-<content-hash>.json`. These filenames are not nested Biome
configuration names. Existing backups are never overwritten with different bytes.
Copy the required backup back to the original configuration filename to recover
it, then review the policy and ownership metadata before syncing again.

The ownership record is written after the configuration. An interrupted update,
missing metadata or invalid metadata cannot authorize replacing an unknown array.
Before writing, Pawl verifies that the configuration, metadata and backup paths
are plain files inside plain directories. It refuses symbolic links, linked files
and unknown existing metadata; it never uses them as permission to overwrite
another file. Plans recheck those paths and the metadata at apply time, and also
refuse configuration edited after the plan was made.
Repeated successful syncs produce no further writes.

### Reconcile customized or older scopes

Pawl never infers ownership from an array that resembles its output. Older
configurations without metadata, and arrays edited since generation, stay
unchanged when the policy requires different scopes. The check reports
`biome-overrides-conflict` and sync explains the next step.

Reconciliation is an explicit review:

1. Save the original configuration outside Biome's reserved `biome.json` and
   `biome.jsonc` filenames, with a recoverable copy of the original policy.
2. Compare every existing scope, its ordering, options and parser settings with
   the intended root policy. Keep unsupported custom behavior in its original
   configuration until an equivalent representation is verified.
3. After preserving all intended behavior in the policy, explicitly remove the
   reviewed generated array from the root configuration. Do not do this for
   scopes whose behavior has not been preserved.
4. Review `pawl sync --dry-run`, apply it, then check representative valid and
   invalid source with the real engines. Include overlapping scopes and new
   files. Commit the policy, configuration and ownership metadata together.

Do not edit the fingerprint to claim ownership, or delete custom scopes merely
to make the check pass. A hash verifies correspondence with a recorded generated
array; it does not prove that hand-edited policy has preserved your semantics.
