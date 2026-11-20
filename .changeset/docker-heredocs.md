---
"@santi020k/pawl": patch
---

The Docker checks no longer take a here-string (`<<<`) or a shift in shell arithmetic (`1 << 4`) for a heredoc. After one of those, the rest of the Dockerfile was skipped: later problems went unreported, and a `USER` line was missed, so the image was reported as running as root. An instruction with two heredocs is read to the end of both.
