// Santiago Molina's pawl policy. It is data only: pawl reads it, and nothing here runs code.
// Every rule named here is in pawl's catalog, so it means the same on Biome, Oxlint and ESLint.

/** @type {import('@santi020k/pawl').PolicyInput} */
const policy = {
  // The stricter level of every rule that has one, including the type-aware promise rules.
  strict: true,
  rules: {
    // Bugs more often than style, so they fail the check instead of warning.
    'valid-typeof': 'error',
    'no-fallthrough': 'error',
    'no-constant-condition': 'error',
    'no-constant-binary-expression': 'error',
    'array-callback-return': 'error',
    'no-param-reassign': 'error',
    'no-shadow': 'error',
    'no-new': 'error',
    'prefer-promise-reject-errors': 'error',
    'unicorn/throw-new-error': 'error',
    // Types that say nothing, or assertions that change nothing.
    '@typescript-eslint/no-empty-object-type': 'error',
    '@typescript-eslint/no-invalid-void-type': 'error',
    '@typescript-eslint/no-unnecessary-type-assertion': 'error'
  },
  // A repo that extends this policy may tighten these, but not loosen them.
  // Each one is a stable rule in every engine, so a lock never holds back a false positive.
  locked: [
    'no-debugger',
    'no-eval',
    'no-var',
    'eqeqeq',
    '@typescript-eslint/no-explicit-any',
    '@typescript-eslint/no-non-null-assertion',
    '@typescript-eslint/ban-ts-comment',
    'unused-imports/no-unused-imports',
    'no-only-tests/no-only-tests'
  ]
}

export default policy
