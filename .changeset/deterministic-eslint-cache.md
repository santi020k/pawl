---
"@santi020k/pawl": minor
---

Add opt-in `pawl check --eslint-cache` and `check({ eslintCache: true })` with an explicit deterministic-input declaration. Whole-project, dependency, runtime and environment fingerprints guard native ESLint content caching; corrupt cache state reruns cold and failed or interrupted checks cannot publish reusable state. Fixes remain uncached. Also report signal-terminated engine processes as setup failures even if they printed a partial report.
