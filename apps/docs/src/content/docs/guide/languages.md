---

title: Rust, Swift and Kotlin
description: Find the Rust, Swift and Kotlin projects in a repo, keep the JavaScript engines out of them, and check them with their own tools and the same baseline.
---

Pawl's standard is for JavaScript and TypeScript. A repo often holds more than that: a Cargo workspace next to the web app, an iOS app, an Android app. Pawl finds those projects, keeps the JavaScript engines out of the files their tools write, and, when the policy names the language, checks them with the language's own tools, under the same baseline and the same report.

## What pawl finds

Detection looks a few folders deep for the file that marks each kind of project:

| Language | Marked by                                                                              | One project                                                        |
| -------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Rust     | `Cargo.toml`                                                                           | A crate, or a Cargo workspace with its member crates               |
| Swift    | `Package.swift`, an `.xcodeproj` or an `.xcworkspace` folder                           | A Swift package, or an Xcode app with the local packages inside it |
| Kotlin   | `settings.gradle.kts`, `build.gradle.kts`, or a Gradle or Maven build that uses Kotlin | A Gradle build with its modules, or a Maven project                |

A Java build with no Kotlin in it is not counted. A project the repo ignores is not counted either: the `ios` and `android` folders an Expo prebuild writes are usually in the `.gitignore`.

`pawl doctor` lists every project it found and whether pawl checks it:

```txt
Project:  TypeScript, React, Rust, Swift, Kotlin, Turborepo with 3 packages, pnpm
Rust:     the root (Cargo.toml), checked with Clippy and rustfmt
Kotlin:   apps/android (settings.gradle.kts), not checked (add "kotlin" to languages in the policy, or check it with Quality)
Swift:    apps/ios (App.xcodeproj), not checked (add "swift" to languages in the policy, or check it with Quality)
```

To leave one language out of detection altogether, add it to [`detect.exclude`](/reference/config/#detect).

## Keeping the JavaScript engines out

Biome, Oxlint and ESLint read JSON, Markdown, YAML and TOML wherever they find them. Some of those files in a native project are written by a tool, and reformatting them only makes noise. Pawl skips them by default:

- Cargo's `target` folder, next to each Rust project only, because `target` is also a name people give their own code. It holds the JavaScript of the docs `cargo doc` builds.
- `Cargo.lock` and `Package.resolved`, the lockfiles of Cargo and Swift Package Manager.
- Xcode's bundles and data: `*.xcodeproj`, `*.xcworkspace`, the `*.xcassets` asset catalogs, whose `Contents.json` files Xcode rewrites, `xcuserdata` and `DerivedData`.
- The build folders of Swift Package Manager, CocoaPods and Gradle: `.build`, `.swiftpm`, `Pods`, `.gradle`, `.kotlin` and `.cxx`.

They are part of [`defaultIgnores`](/reference/config/#defaultignores), so `defaultIgnores: false` checks them again.

## Checking them with pawl

Name the languages in the policy:

```ts title="pawl.config.ts"
import { definePolicy } from '@santi020k/pawl'

export default definePolicy({
  languages: ['rust', 'swift', 'kotlin']
})
```

`pawl check` then runs each language's tools in each of its projects, next to the JavaScript engines:

| Language | Lint                                     | Format                                       | `pawl fix`                                 |
| -------- | ---------------------------------------- | -------------------------------------------- | ------------------------------------------ |
| Rust     | `cargo clippy --workspace --all-targets` | `cargo fmt --all --check`                    | `cargo clippy --fix`, then `cargo fmt`     |
| Swift    | `swiftlint lint`                         | `swiftformat --lint`, or `swift-format lint` | `swiftlint lint --fix`, then the formatter |
| Kotlin   | `ktlint`                                 | `ktlint`, which also checks the style        | `ktlint --format`                          |

Swift has two formatters. Pawl uses the one whose config the project has, `.swiftformat` for [SwiftFormat](https://github.com/nicklockwood/SwiftFormat) or `.swift-format` for Apple's [swift-format](https://github.com/swiftlang/swift-format). With neither, it uses SwiftFormat when it is installed, else swift-format.

Every finding lands in the same report as the JavaScript ones, with the tool's own rule name: `clippy:needless_return`, `rustc:unused_variables` for a warning of the compiler, `swiftlint:force_cast`, `swiftformat:indent`, `ktlint:standard:no-wildcard-imports`. A file rustfmt would change is `pawl/format`, as a file Biome would change is.

Then the rest of pawl works as it does for JavaScript:

- **The baseline.** `pawl baseline` records what the tools find today, and from then on only new findings fail the check.
- **`--changed` and `--since`.** A project is checked only when one of its source files changed. Clippy builds the whole crate, so it runs on the crate and pawl keeps the findings in the changed files.
- **Agents.** `pawl check --format agent` prints Rust, Swift and Kotlin findings in the same one-line JSON.
- **Exit codes.** A tool that is not installed, or that fails, is a setup problem with exit code 2, never a pass. `pawl baseline` does not record a baseline while a tool is missing, so it cannot forget what the baseline allowed.

### The tools' own config

Pawl runs each tool with the project's own config and writes none for it: `clippy.toml` and `rustfmt.toml`, `.swiftlint.yml`, `.swiftformat` or `.swift-format`, and `.editorconfig` for ktlint. SwiftLint runs with `--force-exclude`, so its `excluded` list holds even though pawl passes the files.

The policy can still set the level of a tool's rule, by the name pawl reports it under, in `rules` and in `overrides`. `off` drops the finding, `warn` and `error` set how it counts:

```ts title="pawl.config.ts"
export default definePolicy({
  languages: ['rust'],
  rules: {
    'clippy:unwrap_used': 'error',
    'rustc:dead_code': 'off'
  },
  overrides: [{ files: ['crates/*/tests/**'], rules: { 'clippy:unwrap_used': 'off' } }]
})
```

A company policy can [lock](/guide/policy/#a-shared-policy) these rules as it locks any other.

### Turning one tool off

Each language takes `true`, `false`, or the tools to run:

```ts title="pawl.config.ts"
export default definePolicy({
  languages: {
    rust: true,
    // SwiftLint only: the team formats Swift in Xcode.
    swift: { format: false }
  }
})
```

A later layer can switch a language off with `false`. Naming a language in a list keeps the tools an earlier layer chose for it.

### Installing the tools

The tools are not npm packages, so pawl does not install them. `pawl doctor` says which ones are missing:

- **Rust:** [rustup](https://rustup.rs), then `rustup component add clippy rustfmt`.
- **Swift:** `brew install swiftlint swiftformat`. Apple's swift-format comes with Swift 6 and Xcode 16 as `swift format`, and works in place of SwiftFormat.
- **Kotlin:** `brew install ktlint`, or the binary from [ktlint's releases](https://github.com/pinterest/ktlint/releases). It needs Java.

In CI, install them in the job before `pawl check`. Clippy builds the code, so cache Cargo's `target` folder between runs.

## With Quality

[Quality](/guide/quality/) also runs Clippy, cargo fmt, SwiftLint, SwiftFormat and ktlint, and adds detekt and Android Lint. Pick one place for each language, or the same files are checked twice:

- **Quality checks them.** Leave `languages` out of the policy. Pawl still keeps the JavaScript engines out of the native folders.
- **Pawl checks them.** Name them in `languages`, and set `check: false` for the matching adapters in `quality.yml`, so each tool runs once, under pawl's baseline. `quality format` and `quality fix` can still use them.

## What is not covered

- Java on its own, Go, Python and other languages. Pawl finds no project in them.
- Detekt, and ktlint or SwiftLint run through a Gradle or Swift Package Manager plugin. Pawl runs the command-line tools.
- A standard of pawl's own for these languages. Each tool runs with its own rules and the project's config; pawl adds the baseline, the report and the policy levels on top.
