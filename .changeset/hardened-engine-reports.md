---
'@santi020k/pawl': patch
---

A check that did not run right can no longer pass as a clean one, and pawl reads the disk more carefully.

- When Biome or Oxlint exits with a code above 1, prints a report entry pawl cannot read, or exits with a code its own report contradicts, the check stops with a setup problem and exit code 2. A Biome or Oxlint config that the engine cannot load is one such case.
- A `.pawl/baseline.json` with a count that is not a whole number of zero or more cannot be read, like one with a merge conflict: the check stops with exit code 2 and says to run `pawl baseline`.
- Pawl's own checks skip a folder that git lists as a file, such as a submodule. Symbolic links to files are still checked.
- A project root given with a trailing slash, or through a symbolic link, names files the same way as any other root.
- A JSON file pawl edits keeps a key such as `__proto__` or `constructor` as a plain key.
- `--eslint-cache` reads the files it fingerprints in chunks, and refuses a cache folder or ownership file that is a broken symbolic link.
- A check of the whole project lists the project's files once, not once for each of pawl's own checks.
