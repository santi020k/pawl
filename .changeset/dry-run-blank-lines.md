---
'@santi020k/pawl': patch
---

`pawl sync --dry-run` with nothing to sync says "Config files are up to date." instead of printing two blank lines before "Dry run. Nothing was changed.". The dry runs of `sync`, `add` and `upgrade` no longer start with a blank line when they have nothing to list, nor print two in a row when there are no notes.
