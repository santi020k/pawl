---

title: Astro coverage boundaries
description: "Keep Astro validation alongside Pawl and understand Biome's scoped parser and virtual import limitations."
---

Pawl's `doctor` reports known Astro coverage limits under `Coverage`. JSON reports
include these messages in `limitations`, separate from `problems`. A limitation is
advisory: Pawl cannot tell whether your CI already runs the framework validator,
and it does not disable rules or change configuration in response.

## Keep framework validation

Run `astro check` and `astro build` alongside `pawl check` for each Astro application.
Biome 2.6.8 does not fully understand Astro's virtual modules, including
`astro:content` and `astro:transitions/client`, or the default exports of `.astro`
components. Its `correctness/noUnresolvedImports` rule can report these valid host
imports. Pawl retains the diagnostics rather than silently granting those module
names to unrelated projects.

Keep semantic import checks from your existing shared ESLint configuration when
it provides the required Astro parser and resolver. Validate both real framework
imports and an ordinary misspelled import before changing rule ownership. Do not
turn off unresolved-import checks across the repository or loosen locked rules
merely to remove the framework diagnostics. If a narrow exception is necessary,
review its exact host scope and retain the framework validator as a required gate.

## Scoped parser options are not equivalent

Biome 2.6.8 accepts `html.experimentalFullSupportEnabled` inside `overrides`, but
that does not reliably enable Astro template expression parsing. Pawl's real-engine
regression uses an invalid Astro expression that passes the scoped setting and
produces a parse error with the same option at the root.

A root-level opt-in changes the parser for the project; it is a separate decision,
not an automatic repair for scoped settings. Keep customized nested configurations
and a recoverable backup. Pawl continues to block nested Biome configuration whose
scopes cannot be preserved; it does not move these settings into an override and
claim equivalent validation. An accepted configuration or a clean `doctor` report
alone does not establish parser coverage.
