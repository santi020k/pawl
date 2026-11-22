---
"@santi020k/pawl": patch
---

`pawl check` and `pawl fix` take a file by any path: with a leading `./`, or absolute, as lint-staged passes it. Until now such a file missed its baseline, so its old findings and disable comments failed as new, and for an absolute path pawl's own Docker and Markdown checks and the ratchet on disable comments did not run at all. A folder now stands for every file in it in those checks too, and a path outside the project is left out.
