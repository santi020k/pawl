---
'@santi020k/pawl': patch
---

Installing a pinned tool keeps it pinned, and installing into a Yarn 1 workspace works.

- Under npm, the exact versions pawl installs, Biome's in `pawl init`, and Biome's and Oxlint's in `pawl upgrade`, go in with `--save-exact`, in a command of their own before the rest. npm wrote `^` before the version it was given, so package.json allowed a newer Biome than the one pawl reads, and the next fresh install could bring one. pnpm, Yarn and Bun already keep an exact version exact.
- At the root of a Yarn 1 workspace, `pawl upgrade`, `pawl init` and `pawl add` now pass `-W`, without which Yarn 1 refuses to add to the root, so the install failed. Yarn 2 and later, which refuse `-W`, still get none; pawl tells them apart by the `packageManager` field, `.yarnrc.yml` and the lockfile.
