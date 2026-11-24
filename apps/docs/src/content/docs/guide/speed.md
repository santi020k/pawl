---

title: Speed and CI tasks
description: "Make checks faster without losing coverage: cache ESLint with declared inputs, give each lint task one owner, and see which cached tasks a file reaches."
---

Ways to make checks faster that keep every file checked by every engine it needs. Each one is opt-in or advisory: pawl never skips a file to save time.

## Cache ESLint checks

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

### What is covered

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

### When to leave caching off

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

### Storage and measurements

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

## Lint task ownership

`pawl doctor` reports potential directory overlap between declared root and workspace package lint commands. For example, root `eslint .` and `apps/web`'s `eslint .` may both visit `apps/web/src/page.ts`. Pawl also reports overlap between `pawl check` and a separate engine command, because Pawl may already run that engine.

This is advisory evidence from package scripts, not a trace of commands executed. Different engine commands can provide different semantic coverage; an ESLint pack next to Biome is not redundant just because they read the same file. Engine ignores and configuration can also separate apparently overlapping directories. Check the actual task graph before removing a command.

### Give each check one owner

For a workspace-wide Pawl policy, use a single root task:

```json
{
  "scripts": {
    "check": "pawl check",
    "typecheck": "turbo run typecheck",
    "test": "turbo run test"
  }
}
```

Keep type checks, framework checks, tests and native toolchains. Remove a package lint invocation only after proving that the root check runs every required engine on that package. If packages have independent policies, run their checks from the root orchestrator and restrict a separate root check to root-owned files. Do not exclude a package just to remove a duplicate diagnostic.

When task outputs are cached, include shared policy, lint configuration, plugins, resolver settings and the lockfile in the inputs of every affected task. A change to shared configuration must rerun every consumer. Avoid caching a root-wide check with only one package's source as its inputs.

### Verify coverage before and after

1. Record the actual commands and their working directories from an uncached full run (`pawl check --verbose` shows engine commands).
2. For each required engine, choose a representative file in every workspace, including framework files. Introduce a temporary violation unique to that engine and verify that the owning task fails. Restore the file afterward.
3. Run the proposed task graph without caching. Confirm that each intended engine invocation owns its files once and that all invalid fixtures still fail.
4. Change shared configuration and verify that cache invalidation reruns all affected tasks. Compare cold and warm timing only after the coverage matches.

The diagnostic recognizes simple literal directory targets of Pawl, Biome, ESLint, Oxlint and Prettier. It does not execute package scripts. Shell wrappers, quoted targets, globs, changed-file flags and unsupported options have unknown scope; missing overlap evidence never proves disjoint traversal. File-only targets and alternatives within one manifest are not reported as root/package overlap. Programmatic consumers can call `analyzeLintTraversal(root, packageDirectories)` for the commands, overlaps and unknown scopes.

## Task reachability

Task reachability is diagnostic evidence about package scripts and Turbo caching.
It never disables a rule or exempts a file from checking.

The analysis reads package manifests and `turbo.json` or `turbo.jsonc`. It recognizes
literal `node file.js` and `tsx file.ts` commands, local `pnpm run name` (also npm,
Yarn and Bun) references, and exact relative static imports. Workspace paths are
relative to the repository root. In a workspace, root tasks must be registered
with `//#name`; a standalone project uses bare task names such as `build`. Qualified
task names in a standalone configuration are invalid and reported as unknown.
A configured task is cached unless it explicitly sets `cache: false`.

Files have four possible classifications:

- **cached**: a cached task is a known consumer.
- **uncached**: the supported graph only supplies uncached consumers.
- **mixed**: both cached and uncached tasks are known consumers.
- **unknown**: incomplete evidence prevents an uncached classification.

The analysis always marks its evidence as incomplete. These are observations of
declared scripts, not proof about every possible way to execute a module. Even an
uncached result does not prove that a file is used exclusively without caching. A cached or mixed result remains useful even when other consumers
are unknown. A file absent from the report has not been classified.

Shell expressions, CLI flags, framework entry discovery, dynamic imports, package
imports, missing files, cyclic script aliases and package-level Turbo inheritance
are reported for manual review. No scripts or executable configuration are run.
Relative imports must name an existing file including its extension. Traversal is
bounded to 500 modules per entry and never follows files outside the repository.

Review shared modules before changing environment-variable declarations or cache
settings. Keep lint checks enabled when reachability is uncertain. The report does
not validate Turbo dependency ordering, cache keys or environment-variable coverage.
See [Turbo configuration](https://turborepo.dev/docs/reference/configuration) for
the task runner's complete configuration contract.

### Declare inputs where they affect cached output

For a standalone project, a build that reads `PUBLIC_API_URL` and shared policy
configuration can declare those inputs explicitly:

```json
{
  "globalDependencies": ["shared-policy.json"],
  "tasks": {
    "build": {
      "env": ["PUBLIC_API_URL"],
      "outputs": ["dist/**"]
    }
  }
}
```

Use task-level inputs instead when the shared file affects only selected tasks.
Keep environment variables used only by direct deployment orchestration or test
sandboxes out of global cache inputs. A variable used by a cached consumer must
still be declared there; a script's folder or name cannot establish that boundary.

The regression tests ask the real Turbo CLI for dry-run task hashes. Changing a
declared output input changes its build hash; changing unrelated orchestration or
sandbox variables does not. Changing declared shared configuration changes both
fixture consumers' hashes, even when their task inputs only include scripts.
These tests validate hashing, not cached output restoration or a production task
execution trace. Validate those behaviors in the consuming repository too.
