---

title: Cache ESLint checks
description: Opt in to native ESLint reuse with declared deterministic inputs and conservative invalidation.
---

ESLint caching is off by default. Enable it only after reviewing the configuration,
plugins, processors and resolvers for deterministic behavior. This is an explicit
input contract, not automatic proof that executable configuration is safe to cache.

Create `.pawl/eslint-cache.json`:

```json
{
  "version": 1,
  "deterministic": true,
  "inputs": ["../shared-types", "../shared-eslint"]
}
```

`inputs` contains filesystem paths, relative to the project root or absolute,
not glob patterns. Declare every external file or directory that can affect lint
results. An empty array is valid only when the project and its installed
dependencies contain every filesystem input. Missing paths are tracked, so
creating them invalidates the cache too.

```sh
pawl check --eslint-cache
```

The library equivalent is `check({ root, eslintCache: true })`. Both require the
same declaration. A missing, malformed or unsupported declaration is a blocking
setup error, not an uncached success.

## What is covered

Pawl fingerprints the entire project, including ignored files, source and type
dependencies, policy, configuration, lockfiles and actual installed package
contents. It follows dependency symlinks and includes Node resolution ancestors,
so a changed plugin or resolver invalidates reuse even without a version bump.
Declared external trees, Node runtime/version, execution flags and environment
also participate. Only the dedicated `.pawl/cache/eslint` output is excluded.
Environment values and source contents are hashed; they are not written into
cache metadata or diagnostics.

Every invocation starts ESLint and loads its configuration. Pawl selects native
ESLint content caching only inside the matching whole-project fingerprint. A
change to any input invalidates the whole native cache, including results for
unchanged files that depend on types or processor inputs elsewhere.

Pawl checks the fingerprint again after ESLint finishes. Changing inputs during
the run produces a setup failure. Keep the input trees stable while a check runs.
A failed setup, interrupted process or malformed report never replaces the last
valid cache. Cache files carry an integrity checksum; corrupt or incomplete state
causes a cold run. Successful state is promoted atomically.

`pawl fix` always runs uncached, even with `--eslint-cache`. Baselines and Pawl's
other engines and scans continue to run normally; this feature does not cache
whole check results or bypass setup validation.

## When to leave caching off

Do not opt in when a rule or configuration depends on time, randomness, network
responses, subprocess state or undeclared files. Declare filesystem inputs read
by subprocesses too. Git worktree metadata can live outside the project; declare
it if a rule depends on Git state. A declaration is a trusted maintainer assertion,
not a sandbox or a dependency analyzer. Do not read the cache directory from a
rule or use it as an input.

Unknown inputs must be resolved before opting in. If a tree is unreadable,
contains unsupported special files, or exceeds 100,000 entries or 2 GiB of file
contents, caching fails closed. Run without `--eslint-cache` to check normally.
These limits bound fingerprint work; they do not expand ignores or reduce lint
coverage.

## Storage and measurements

Pawl owns `.pawl/cache/eslint`, with an ownership marker, one current cache record
and temporary per-run files. It refuses an existing unowned directory rather than
overwriting its contents. Keep this directory local and out of version control.
It contains ESLint diagnostic data, so treat it as local development state, not a
public artifact. You may remove this dedicated cache directory to force a cold run;
do not remove other `.pawl` files such as the baseline.

Fingerprinting every input has a cost. Compare repeated cold and warm runs with
identical coverage before enabling caching in CI or claiming a speed improvement.
For a small project, an uncached check can be faster. Changes to environment or
any input intentionally reduce reuse.
