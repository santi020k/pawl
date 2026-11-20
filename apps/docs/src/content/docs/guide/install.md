---

title: Install
description: What pawl needs, how init installs it, and the optional tools it can run.
---

:::caution[Early]
Pawl is early, and the API may still change before 1.0.
:::

## Requirements

Node 22.18 or later.

## Run it

```sh
npx @santi020k/pawl init
```

`init` adds `@santi020k/pawl` to the project's `devDependencies`, together with the tools you pick, and installs them with the project's package manager. The [getting started](/guide/getting-started/) guide walks through the rest.

Pawl finds the package manager from the `packageManager` field in `package.json`, then from the lockfile. Without either it uses npm.

| Package manager | Command `init` runs |
| --------------- | ------------------- |
| npm             | `npm install -D`    |
| pnpm            | `pnpm add -D`       |
| yarn            | `yarn add -D`       |
| Bun             | `bun add -d`        |

In a pnpm workspace it adds `-w`, so the tools go in the root.

If the install fails, pawl prints the command to run yourself and exits with code 2. With `--no-install`, it writes the packages into `devDependencies` instead and leaves the install to you.

## The tools

Pawl has no dependencies. Every engine, formatter and ESLint plugin is an optional peer: your project installs the ones it uses, and pawl loads them from there.

| Package          | What it is for                                     | Peer range       |
| ---------------- | -------------------------------------------------- | ---------------- |
| `@biomejs/biome` | Lint and format. The default for both.             | `2.6.8`, exactly |
| `oxlint`         | Lint, with ESLint's rule names                     | `>=1.94.0`       |
| `eslint`         | Lint, and the host for every [pack](/guide/packs/) | `>=9.22.0`       |
| `prettier`       | Format                                             | `>=3.0.0`        |

With nothing chosen, Biome lints and formats. [Choosing tools](/guide/tools/) covers the other mixes.

Biome is pinned to one exact version, because pawl reads a report format Biome may change between releases. `init` installs that version.

### ESLint as the linter

When ESLint is the linter, `init` also installs `@eslint/js`, and `typescript-eslint` in a TypeScript project. These run the `javascript` and `typescript` packs.

| Package             | Peer range |
| ------------------- | ---------- |
| `@eslint/js`        | `>=9.0.0`  |
| `typescript-eslint` | `>=8.0.0`  |

### Plugins

Each optional [pack](/guide/packs/) runs one ESLint plugin, and the plugin is an optional peer too. `pawl add <pack>` installs ESLint and the plugin. A pack that is wanted but whose plugin is missing, or fails to load, is listed by `pawl doctor`.

## Check the install

```sh
pawl doctor
```

It shows which tools are in use and whether each one is installed. See [Troubleshooting](/guide/troubleshooting/#pawl-doctor).
