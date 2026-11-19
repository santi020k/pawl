## Release

Version: `v`

- [ ] The branch is `release/v<version>` and `pnpm release:check` passes.
- [ ] `pnpm version-packages` consumed every changeset; versions, changelogs and the lockfile are committed together.
- [ ] `pnpm ok` passes on this revision.

## Changes

<!-- The highlights of the changelogs. -->

## Migration notes

<!-- What a user has to change, or "None". -->

## Rollback

<!-- A published version is never replaced. Say how a bad release is handled: deprecate it on npm and release a fix. -->

## After the merge

- [ ] The Release workflow passed on `main`.
- [ ] `npm view @santi020k/pawl version` shows the new version and the GitHub release exists.
- [ ] The release branch is deleted.
