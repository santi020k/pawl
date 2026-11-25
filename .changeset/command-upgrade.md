---
'@santi020k/pawl': minor
---

`pawl upgrade` installs the tool versions this pawl works with, then syncs the config files. Run it after you move to a new version of pawl.

It installs each tool that is installed and outside the versions pawl works with, as `pawl doctor` reports them. Biome, Oxlint and `oxlint-tsgolint` go to the exact version pawl is built for. ESLint, Prettier, `typescript-eslint` and the plugins of the packs the policy names go to the newest version of the major version they are on, such as `eslint@9` for ESLint 9.30, when it has one pawl works with; only a tool whose major version has none moves to a new one, the nearest pawl works with, and the plan says so. It uses the project's own package manager, and runs `pawl sync` once the new versions are in place. `--dry-run` shows what it would install and changes nothing, and `--no-install` only syncs. A tool that is not installed is left to `pawl add` and `pawl init`, and Node to you.

- In a workspace, a tool goes into each package that declares it, in the dependency group it is in there, and into the root only when no package declares it. A package with no name, which no install command can point at, gets a note with what to install there.
- Moving `eslint-plugin-vue` from 9 to 10 also installs `vue-eslint-parser` 10, which the plugin takes as a peer from version 10 on. Under npm it goes first, in a command of its own, because npm cannot swap the plugin and the parser its old version brought in one install and stops with `ERESOLVE`.
