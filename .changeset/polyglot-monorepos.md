---
"@santi020k/pawl": minor
---

Rust, Swift and Kotlin, and monorepos that mix stacks.

- Detection finds Cargo crates and workspaces, Swift packages, Xcode projects, and Gradle or Maven builds that use Kotlin, anywhere a few folders deep. `pawl doctor` lists each one and says whether pawl checks it, `init` says how to turn them on, and `detect.exclude` takes `rust`, `swift` and `kotlin`.
- Biome, Oxlint, ESLint and pawl's own checks skip what those tools write: `target` next to each Rust or Maven project, `Cargo.lock`, `Package.resolved`, Xcode's bundles and asset catalogs, `Pods`, `.build`, `.swiftpm`, `.gradle` and others. They are part of `defaultIgnores`.
- `languages` in the policy runs each language's own tools in its projects: Clippy and rustfmt, SwiftLint and SwiftFormat or swift-format, ktlint. Findings join the same report and baseline, with the tool's rule names (`clippy:needless_return`, `swiftlint:force_cast`), and `rules` and `overrides` set their levels. `pawl fix` runs their fixes. A missing tool is the new `language-tool-missing` setup problem, exit code 2.
- Under Oxlint and ESLint, a technology's rules now run only in the packages that use it, as they already did under Biome. Oxlint gets an override per package with the plugins those rules need, and ESLint a block per package; a pack only some packages depend on runs in those packages. Run `pawl sync` to update `.oxlintrc.json`: in a monorepo for the overrides, and in any project on Oxlint for the new default ignores.
- `pawl baseline` no longer records a baseline while part of the check did not run, and `pawl check` no longer suggests shrinking the baseline then.
