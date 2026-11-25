---
'@santi020k/pawl': patch
---

Two `pawl check --eslint-cache` runs that start at the same time in a project without an ESLint cache yet both run. The second one found the cache directory the first had just taken and stopped with "ESLint cache inputs or storage could not be read safely", a setup problem with exit code 2. It now checks that the directory is pawl's, as it does for any cache that exists, and goes on.
