---
'@santi020k/pawl': minor
---

`pawl upgrade` installs the tool versions this pawl works with, then syncs the config files. It moves each tool that is installed and outside its range, as `pawl doctor` reports them: Biome and Oxlint at the exact version pawl pins, and ESLint, Prettier, `typescript-eslint`, `oxlint-tsgolint` and the plugins of the packs the policy names at their newest version. It installs with the project's own package manager and runs `pawl sync` once the new versions are in place. `--dry-run` shows what it would install, and `--no-install` only syncs. A tool that is not installed is left to `pawl add` and `pawl init`, and Node to you.
