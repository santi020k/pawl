# Contributing

Thank you for improving pawl. Read [AGENTS.md](AGENTS.md) first: it holds the rules of the codebase.

## Setup

Use Node.js 22.18 or newer and pnpm (the version in `packageManager`):

```sh
pnpm install
pnpm hooks:install   # commit-msg, pre-commit and pre-push hooks, run by Quality
pnpm ok              # the full gate CI runs
```

The hooks come from [`quality.yml`](quality.yml) and need the [Quality CLI](https://github.com/santi020k/quality).

## Santiago-owned tools

| Tool         | Use in this repository                                                                                                                                                                          |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lumen UI     | Landing-page components and semantic tokens in `apps/docs`.                                                                                                                                     |
| OG           | Social-card generation, metadata and JSON-LD; `pnpm docs:build` generates the cards, and `pnpm --filter @santi020k/pawl-docs run audit` checks the built site. CI and deployment run the audit. |
| Astro Doctor | `pnpm --filter @santi020k/pawl-docs run doctor`, also run in CI.                                                                                                                                |
| Quality      | Git hooks and the repository-check task in `quality.yml`, plus the shared pnpm setup action in CI. `pnpm ok` remains the canonical gate.                                                        |
| Commitprompt | `pnpm commit` and commit-message validation through the Quality hook.                                                                                                                           |
| Dep Beacon   | Recommended in `.vscode/extensions.json` for dependency versions, pnpm catalogs and OSV findings in the editor.                                                                                 |

In VS Code, install the recommended [Dep Beacon extension](https://marketplace.visualstudio.com/items?itemName=santi020k.vscode-dep-beacon), then open `package.json` or `pnpm-workspace.yaml`. In Zed, install Dep Beacon from the extension registry; it needs no project configuration. This is editor assistance, not a CI gate. Review updates before applying them and regenerate the lockfile with the repository's pnpm version. Keep Biome and Oxlint upgrades coordinated with the generated-file checks described in [AGENTS.md](AGENTS.md).

Pawl itself supplies this repository's lint policy, replacing ESLint Config Basic. The docs intentionally use their own Signal brand rather than the Santiago Theme. Auth is not needed for this public static site and CLI.

## Commits

Commits follow Conventional Commits. `pnpm commit` opens [Commitprompt](https://github.com/santi020k/commitprompt), and the `commit-msg` hook validates every message.

## Changesets

Run `pnpm changeset` for any user-visible change to `@santi020k/pawl`. Choose patch, minor or major by semantic versioning and describe the effect for users. Changes that do not affect the package can use the `skip-changelog` label instead. The `Changeset` workflow checks this, and is the only one that runs again when a label changes.

## Pull requests

Use a Conventional Commit title, keep changes focused and add tests for behavior changes. After changing a rule, the style or the Biome version, regenerate the presets and the rules page; `pnpm ok` fails if they are out of date.

## Releases

`@santi020k/pawl` and `@santi020k/pawl-policy` share one version. A release is a pull request from a `release/v<version>` branch into `main`; nothing else changes a version, and CI refuses a version change on any other branch.

1. Start from an up-to-date `main` and create the branch. Changesets decides the version: run `pnpm changeset status` to see it, then `git switch -c release/v<version>`.
2. Run `pnpm version-packages`. It consumes the changesets and writes the versions, the changelogs and the lockfile. It needs a `GITHUB_TOKEN` to link pull requests in the changelog. Commit the result.
3. Run `pnpm release:check`, then push the branch and open the pull request with `gh pr create --template release.md`. CI runs the same check: the branch name, every package version and the changelogs must agree, no changeset may be left, and the version must be new on npm and untagged.
4. Merge the pull request. `.github/workflows/release.yml` runs on `main`: it validates the repository, unless CI already passed on the pull request's head and the merged commit has exactly those files, publishes the versions npm does not have with provenance through trusted publishing, installs them from the registry, then creates the `v<version>` tag and the GitHub release on the merged commit. Last, it starts the docs deploy, so the [changelog page](https://pawl.santi020k.com/changelog/) shows the release with its date; the merge itself does not deploy the docs, so a release deploys them once. If the docs did not deploy, start the Release run again, or run `gh workflow run deploy-docs.yml --ref main`.
5. Check the release on npm and GitHub, then delete the release branch.

Work for the next version can start before the current one is out: create its `release/v<version>` branch early and open feature pull requests into it. CI checks those pull requests like the ones into `main`, and each still needs a changeset. Run `pnpm version-packages` on the branch only when the release is ready.

The workflow publishes only what is missing, so a failed run is fixed with "Re-run failed jobs" on that same run, which keeps the release commit. Do not merge anything else into `main` until the release run is green; the workflow refuses to release a later commit that carries new changesets. A published version or tag is never replaced: fix a bad release with a new version. To roll back, deprecate the version with `npm deprecate` and release a fix.

### First release and setup

npm trusted publishing cannot create a package, so a new package gets a placeholder first: version `0.0.0`, published by hand, with only a `package.json` (its name and `repository`) and a README that says to install a real version. Do this right before the release pull request merges, because npm drops a trusted publisher that has not published within 2 days of being added:

1. Publish the placeholder of each new package with `npm publish --access public` from a temporary directory.
2. Add `release.yml` as its trusted publisher, allowed to publish: `npx npm@12 trust github <package> --repo santi020k/pawl --file release.yml --env npm --allow-publish`.
3. Merge. The Release run publishes the real version through trusted publishing, with provenance, which also validates the trusted publisher.
4. Deprecate the placeholder: `npm deprecate <package>@0.0.0 "Placeholder. Install 0.1.0 or later."`

If a Release run stops because a package is not on npm, do steps 1 and 2 for it, then choose "Re-run failed jobs" on that run.

The `npm` and `docs-production` environments on GitHub allow only the `main` branch; `docs-production` holds the Cloudflare secrets described in [apps/docs/README.md](apps/docs/README.md#deploy). Protect `main` so that it takes pull requests only and requires the CI checks.

### The changelog page

The site's changelog is built from each package's `CHANGELOG.md`, the `v<version>` tags and the pending changesets, so it needs no step of its own: the changesets in a release are its notes. Write each changeset for the people who use pawl, since it is published as written. See [apps/docs/README.md](apps/docs/README.md#changelog).

## Secrets

Secrets live in Doppler, in the `pawl` project, never in the repository. The `prd` config holds what the docs deploy needs, `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, and a Doppler sync writes them to the `docs-production` environment on GitHub. Change a secret in Doppler; a value edited in GitHub is overwritten by the next sync.

Publishing to npm needs no secret at all: it goes through trusted publishing.

Normal builds, checks and docs development need no secrets and run without Doppler. For work that needs secrets, install the [Doppler CLI](https://docs.doppler.com/docs/install-cli), then run these commands from the repository root:

```sh
doppler login --scope .
doppler setup --project pawl --config dev --no-interactive
doppler run -- pnpm docs:dev
```

[`doppler.yaml`](doppler.yaml) also selects `pawl/dev` when running interactive `doppler setup`. Scope the login and setup to each checkout; do not use `prd` for local development. Never commit a secret or an `.env` file, or print the injected environment.

### Deployment sync

Keep one GitHub Actions sync from Doppler `pawl/prd` to repository `santi020k/pawl`, environment `docs-production`. Sync `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as secrets, not variables. The environment allows deployments from `main` only. The workflow consumes the synced secrets directly, so it needs no Doppler service token or CLI in CI, and the docs build does not receive Cloudflare credentials.

To verify the connection without revealing values:

1. In Doppler, open `pawl` → `prd` → **Config Syncs** and confirm the GitHub destination is `santi020k/pawl/docs-production` and the status is **In Sync**.
2. Run `gh secret list --repo santi020k/pawl --env docs-production` and confirm both Cloudflare names are present. This lists metadata only; it does not prove the values are valid.
3. Inspect the latest **Deploy Docs** run. Its initial check rejects missing credentials before installing dependencies or building; a successful Cloudflare deployment verifies that the credentials work.

If a sync fails, repair the existing connection and check its status before retrying the deployment. Keep the last working integration until its replacement has been verified. GitHub cannot return stored secret values, so do not delete a sync or its source secrets as a troubleshooting step. Changes to production secrets or their destination require explicit authorization.
