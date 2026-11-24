---

title: One import-sort owner
description: Detect competing import formatters before fixes write files.
---

When Biome and ESLint run together, Pawl resolves ESLint's configuration for the
selected physical files before either engine can fix them. If Biome owns import
organization and ESLint enables `sort-imports`, `import/order`, `import-x/order`,
`simple-import-sort` import/export sorting or Perfectionist import/export sorting,
Pawl reports a blocking setup problem. Full checks and file-scoped hooks use the
same preflight.

Choose one owner. With the generated Biome configuration, disable only the
competing ESLint sorting rules. Retain semantic checks such as unresolved imports,
missing exports and dependency boundaries. Pawl never edits those rules for you.

For custom Biome inheritance or scoped source actions, ownership may be unknown.
Pawl then blocks competing ESLint sorting until you explicitly reconcile the
configurations. With only public Pawl preset inheritance, an explicit root
`assist.actions.source.organizeImports: "off"` lets ESLint own sorting; keep your custom configuration consistent with the policy
and review any drift reported by `doctor` or CI. Explicit global Biome exclusions are respected. Custom inheritance can re-enable
scoped source actions, so a root opt-out alone does not establish ownership there.
Complex scoped ownership is not inferred from a few sample files.

After reviewing the change, run `pawl fix`, `pawl check`, then `pawl fix` again.
The last command should make no diff. Repeat with the file list your Git hook
passes, and verify a deliberately invalid import still fails its semantic rule.
This preflight covers known import-sort owners; it does not claim that arbitrary
custom formatter plugins are equivalent or compatible.
