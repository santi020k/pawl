---
'@santi020k/pawl': patch
---

`pawl check` stops with a setup problem, exit code 2, when the plugin of a pack is installed but fails to load, for example because a peer it needs is missing. A pack the project's dependencies switch on was left out of the check without a word, so the check passed without its rules and only `pawl doctor` said why. A plugin that is not installed at all still only suggests its pack.
