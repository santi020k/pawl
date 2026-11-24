---

title: Lint task ownership
description: "Find overlapping root and package lint commands, give each engine one owner, and verify that removing duplicate traversal preserves checks."
---

`pawl doctor` reports potential directory overlap between declared root and workspace package lint commands. For example, root `eslint .` and `apps/web`'s `eslint .` may both visit `apps/web/src/page.ts`. Pawl also reports overlap between `pawl check` and a separate engine command, because Pawl may already run that engine.

This is advisory evidence from package scripts, not a trace of commands executed. Different engine commands can provide different semantic coverage; an ESLint pack next to Biome is not redundant just because they read the same file. Engine ignores and configuration can also separate apparently overlapping directories. Check the actual task graph before removing a command.

## Give each check one owner

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

## Verify coverage before and after

1. Record the actual commands and their working directories from an uncached full run (`pawl check --verbose` shows engine commands).
2. For each required engine, choose a representative file in every workspace, including framework files. Introduce a temporary violation unique to that engine and verify that the owning task fails. Restore the file afterward.
3. Run the proposed task graph without caching. Confirm that each intended engine invocation owns its files once and that all invalid fixtures still fail.
4. Change shared configuration and verify that cache invalidation reruns all affected tasks. Compare cold and warm timing only after the coverage matches.

The diagnostic recognizes simple literal directory targets of Pawl, Biome, ESLint, Oxlint and Prettier. It does not execute package scripts. Shell wrappers, quoted targets, globs, changed-file flags and unsupported options have unknown scope; missing overlap evidence never proves disjoint traversal. File-only targets and alternatives within one manifest are not reported as root/package overlap. Programmatic consumers can call `analyzeLintTraversal(root, packageDirectories)` for the commands, overlaps and unknown scopes.
