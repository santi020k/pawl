# Roadmap for 0.2.0

The work planned on `release/v0.2.0`. The branch starts from `release/v0.1.0`. Tick an item when it lands on the release branch; move an item to "Deferred" when it leaves this release.

## Branch setup

- [ ] Push the branch: `git push -u origin release/v0.2.0`.
- [ ] After the 0.1.0 pull request merges and its Release run is green, merge `main` into `release/v0.2.0`.
- [x] Run CI on pull requests into a release branch.
- [ ] Every feature on this branch adds a changeset. At least one must be a minor, so that Changesets arrives at 0.2.0.

## Landed

- [x] The recommended `jsx-a11y` rules through Biome and Oxlint, with no plugin.
- [x] The `stencil` pack on the official `@stencil/eslint-plugin`.
- [x] Docs site metadata: `santi-og audit` and its CI step, the icons and `metadata.ts`.
- [x] Rule options for Biome: `biomeOptions` in the policy and in overrides.
- [x] `check --since <ref>`: only the files a branch changed, for pull requests and gradual adoption.

## Candidates

Taken from "What is left" and "Not built yet" in the README and from `docs/rules-from-eslint-config-basic.md`. None is committed to this release until someone starts it.

- [ ] Oxlint's type-aware rules.
- [ ] Move the strict-only rules into the default standard as Biome marks them stable. Biome 2.6.8 is still the newest release, so nothing can move yet.
- [ ] Bring the comparison table in the README up to date. It counts 20 strict-only rules and 7 left out on purpose; the rules document counts 24 and 18.
- [ ] Give more of the 60 rules with no home a check without a plugin. The largest groups: Stencil (18), Angular, typescript-eslint and ESLint core (6 each), Testing Library and Zod (4 each).
- [ ] Packs for Vite and Slidev.
- [ ] Decide on `profile`, `snapshot` and `diff`, and the ESLint MCP scaffold. The README lists them as not planned.

## Closing the release

- [ ] Confirm npm trusted publishing is set for `@santi020k/pawl` and `@santi020k/pawl-policy`, so 0.2.0 publishes with provenance.
- [ ] Run `pnpm version-packages`, commit, then `pnpm release:check`.
- [ ] Open the pull request with `gh pr create --template release.md`.
- [ ] After the Release run is green, check npm and GitHub, then delete the branch and this file.

## Deferred

Nothing yet.
