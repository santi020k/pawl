---

title: Task reachability
description: Understand cached task consumers and uncertain script reachability without weakening lint checks.
---

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

## Declare inputs where they affect cached output

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
