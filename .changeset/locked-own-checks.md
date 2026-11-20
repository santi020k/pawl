---
'@santi020k/pawl': patch
---

A locked Docker or Markdown check, or a locked guard, can no longer be switched off by a later layer. Its own level is the floor, as the default level is for a rule of the catalog, so `off` in `rules` or in an override is kept out and reported as a lock violation. Before, nothing counted as looser than such a check, so the lock did nothing.
