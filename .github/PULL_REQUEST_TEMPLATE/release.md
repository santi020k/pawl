## Release

Version: `v`

- [ ] The branch is `release/v<version>` and `pnpm release:check` passes.
- [ ] `pnpm version-packages` consumed every changeset; versions, changelogs and the lockfile are committed together.
- [ ] `pnpm ok` passes on this revision.
- [ ] The diff of `packages/pawl/api.md` since the last release is reviewed, and every breaking change is in the migration notes.
- [ ] For v1.0.0, track Claude and Codex store submissions and public installation verification using [the plugin launch plan](https://github.com/santi020k/pawl/blob/main/CONTRIBUTING.md#plugin-stores-at-v1); mark this item not applicable for earlier releases.

## Changes

<!-- The highlights of the changelogs. -->

## Migration notes

<!-- What a user has to change, or "None". -->

## Rollback

<!-- A published version is never replaced. Say how a bad release is handled: deprecate it on npm and release a fix. -->

## After the merge

- [ ] For v1.0.0, complete the ESLint Config Basic recommendation release and publish the Medium and santi020k.com launch posts using [the launch kit](https://github.com/santi020k/pawl/blob/main/docs/launch-v1/README.md); record the verified public URLs, or mark this item not applicable for earlier releases.

- [ ] The Release workflow passed on `main`.
- [ ] `npm view @santi020k/pawl version` shows the new version and the GitHub release exists.
- [ ] The release branch is deleted.
