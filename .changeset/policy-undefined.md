---
'@santi020k/pawl': patch
---

A JS or TS policy can set an option to `undefined` again, as in `maxWarnings: ci ? 0 : undefined`. It counts as not set, at any depth, so `style: { quotes: undefined }` keeps the standard's quotes. The check of policy values added in this release refused it. The message for a pack name pawl does not know now lists the guards a policy switches on by name, such as `de-morgan`, with the packs.
