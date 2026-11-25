---
'@santi020k/pawl': patch
---

An engine older than this pawl works with is one setup problem, with exit code 2, instead of pages of the engine's own errors. With Biome 2.5.0, `pawl check` printed about 50 KB of Biome config errors, twice that with `--format github`, and with ESLint 9.30 it said "Could not find preserve-caught-error". Pawl now reads the version of Biome, Oxlint, ESLint and Prettier before it runs them, and one that is older than the versions it declares does not run: the problem names the installed version and the versions pawl works with, and says to run `pawl upgrade`. A version newer than the one pawl pins for Biome still runs, and `pawl doctor` still reports it.
