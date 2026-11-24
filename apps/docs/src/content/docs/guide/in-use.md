---

title: Pawl in use
description: "The repos pawl checks today, what moving to it changed in each, and what the numbers do and do not show."
---

Pawl checks its own code, and the repos below moved to it while 0.4 and 0.5 were being built. They are Santiago Molina's own projects, so read them as a first account from the tool's author, not as independent reviews. Each number says what it was measured against.

## Astro Doctor

[Astro Doctor](https://www.npmjs.com/package/@santi020k/astro-doctor) is a diagnostics tool for Astro sites, with an ESLint plugin of its own. Its repo kept ESLint for the checks only ESLint plugins have, and moved formatting to Biome through pawl.

| Run                        | Before  | After   |
| -------------------------- | ------- | ------- |
| The repo's local lint step | 21.32 s | 10.22 s |

The run is about 52% shorter, most of it from no longer checking the same files twice: the root and each package ran their own lint over the same sources, and [lint task ownership](/guide/speed/#lint-task-ownership) gave each engine one owner. It is one machine, warm, not a controlled cold-cache or CI benchmark, and the coverage changed with the move, so it does not measure one linter against another. The repo's full pre-push gate, its 25 CI tests and its production docs checks passed after the move.

## Quality

[Quality](https://github.com/santi020k/quality) runs a repository's checks as one gate. Its own repo checks with pawl as one of its tasks, with the shared [`@santi020k/pawl-policy`](https://www.npmjs.com/package/@santi020k/pawl-policy).

| Run                      | Pawl's task | The whole command |
| ------------------------ | ----------- | ----------------- |
| Uncached                 | 708 ms      | 1.422 s           |
| Reused, inputs unchanged | 0 ms        | 0.687 s           |

That is Quality's task cache skipping pawl when nothing it reads changed, measured with pawl 0.4.0 from the registry. There was no shared lint gate before to compare with, so it is not a speedup over another tool. See [Pawl and Quality](/guide/quality/) for how the two work together.

## Pawl itself

This repo lints itself with pawl, under its own policy, and its CI fails on anything `pnpm ok` reports. The [benchmarks](/guide/benchmarks/) measure pawl on a copy of its own source and tests, with each engine.

## Your repo

Using pawl on a public repo? Open a pull request that adds it to this page, with what you measured, how, and what the number does not show.
