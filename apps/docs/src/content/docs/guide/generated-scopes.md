---

title: Generated Biome scopes
description: "How Pawl verifies generated override ownership, backs up updates, and preserves customized scopes."
---

When Pawl creates a Biome configuration, it records the exact generated override
array in `.pawl/biome-overrides.json` as a versioned SHA-256 fingerprint. Array
order, rule options and file patterns all participate. Keep this metadata with
the configuration when sharing the project; it is ownership evidence, not a lint
cache. It contains no source contents.

## Safe updates

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

## Reconcile customized or older scopes

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
