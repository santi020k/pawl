---
'@santi020k/pawl': minor
---

`pawl upgrade` installs the tool versions this pawl works with, then syncs the config files. Run it after you move to a new version of pawl.

It installs each tool that is installed and outside the versions pawl works with, as `pawl doctor` reports them: Biome, Oxlint and `oxlint-tsgolint` at the exact version pawl is built for, and ESLint, Prettier, `typescript-eslint` and the plugins of the packs the policy names at their newest version. It uses the project's own package manager, and runs `pawl sync` once the new versions are in place. `--dry-run` shows what it would install and changes nothing, and `--no-install` only syncs. A tool that is not installed is left to `pawl add` and `pawl init`, and Node to you.
