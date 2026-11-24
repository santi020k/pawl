# ESLint Config Basic recommendation release

Editorial status: draft for the Pawl v1 launch. Apply this copy to the ESLint Config Basic README and release notes through its normal release process. Verify the migration guide against Pawl v1 first. No package version or deprecation is proposed here.

## README announcement

### Looking ahead: Pawl

For new projects and teams reviewing their linting setup, I recommend [Pawl](https://pawl.santi020k.com), my next-generation tool for code quality.

Pawl builds on the shared-standard approach behind ESLint Config Basic, with a policy that can work with Biome, Oxlint or ESLint, optional ESLint plugin packs, structured output for coding agents, and a baseline that helps prevent new findings from accumulating.

If you already use ESLint Config Basic, review the [Pawl migration guide](https://pawl.santi020k.com/guide/migrate/) and preview the migration before making changes. Engine coverage and rule options can differ, so review the report and run your project's checks before adopting the new configuration. You can keep ESLint as your lint engine.

## Release-note copy

We recommend evaluating Pawl v1 for new projects and planned migrations from ESLint Config Basic. The README now links to Pawl and its migration guide. This recommendation does not automatically change your configuration or remove existing functionality.

Pawl provides a shared policy for supported lint engines, optional plugin packs, a baseline for existing findings, and output designed for coding agents. Read the [migration guide](https://pawl.santi020k.com/guide/migrate/) before switching, and verify the resulting checks in your own project.

## Release preparation

- Confirm the announcement copy is accurate for the final Pawl v1 release.
- Update the nearest package README and migration documentation in the ESLint Config Basic repository. Follow that repository's changelog and versioning rules.
- Validate the package, obtain the required review, and release through its normal pipeline.
- Verify the published README and release notes, then record the release URL in the Pawl v1 release pull request.
