---
"@santi020k/pawl": minor
---

The Swift and Kotlin checks, run against the real SwiftLint, SwiftFormat, swift-format and ktlint.

- ktlint's report is read after the log lines ktlint prints before it. A project where ktlint had something to fix used to stop with "ktlint exited with code 1".
- SwiftFormat's findings are read when the project sits behind a link, as a temporary folder does on macOS. They used to be dropped, and the check stopped as failed.
- `pawl fix` formats Kotlin with `ktlint --format` and then lints, so what is left is reported once, in the words `pawl check` uses. Before, a finding could appear twice, with "(cannot be auto-corrected)" added.
- Files that the project's own `.swiftlint.yml` leaves out are no longer a failed check when they are the only ones asked for, as with `--changed`.
- A `swiftlint lint --fix` that fails, as on a config it cannot read, stops the fix with the error, where it was hidden.
- A file ktlint cannot parse is the finding `ktlint:parse`.
- `pawl doctor` names the Swift formatter each project uses, SwiftFormat or swift-format, by the config it has, and lists a missing tool for every Swift project, not only the first.
