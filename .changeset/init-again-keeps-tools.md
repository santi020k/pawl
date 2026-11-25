---
'@santi020k/pawl': patch
---

Running `pawl init` again, as `pawl init --hooks` to add the pre-commit hook, keeps the linter and formatter the policy names. It chose Biome whenever no `--engine` was given, so in a project set up for Oxlint it printed "Lint: Biome", planned to rewrite biome.json for Biome as the linter, and told you to choose Oxlint. It now starts from the policy's `engine` and `formatter`, and an option still wins over them.
