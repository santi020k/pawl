# Rules carried over from eslint-config-basic

How each rule that `@santi020k/eslint-config-basic` configured maps into pawl. The mapping comes from Biome's own `biome migrate eslint`, run one rule at a time against Biome 2.6.8, so it reflects what Biome itself considers equivalent.

Only the rules the old config set explicitly are covered here. Rules it inherited from plugin presets (for example `eslint:recommended`) were not listed one by one; Biome's `recommended` preset is on in pawl and covers much of that ground.

## Summary

| Outcome                                                    |   Rules |
| ---------------------------------------------------------- | ------: |
| In the pawl catalog, enforced by Biome with no plugin      |      70 |
| In the catalog as another name for a rule above            |      13 |
| In the catalog, on only under `strict` (unstable in Biome) |      18 |
| Replaced by the formatter or by import sorting             |      39 |
| No dependency-free home yet                                |     113 |
| Left out on purpose                                        |       7 |
| **Total configured in eslint-config-basic**                | **260** |

## Enforced by Biome

Levels are the ones the old config used. Where it used a stronger level in its strict mode, that level applies under `strict: true`.

| Rule                                          | Biome rule                                  | Level                   |
| --------------------------------------------- | ------------------------------------------- | ----------------------- |
| `@eslint-react/dom-no-missing-button-type`    | `a11y/useButtonType`                        | warn                    |
| `@eslint-react/dom-no-unsafe-target-blank`    | `security/noBlankTarget`                    | warn                    |
| `@typescript-eslint/ban-ts-comment`           | `suspicious/noTsIgnore`                     | warn, error when strict |
| `@typescript-eslint/consistent-type-exports`  | `style/useExportType`                       | warn                    |
| `@typescript-eslint/consistent-type-imports`  | `style/useImportType`                       | warn, error when strict |
| `@typescript-eslint/no-deprecated`            | `suspicious/noDeprecatedImports`            | warn                    |
| `@typescript-eslint/no-duplicate-enum-values` | `suspicious/noDuplicateEnumValues`          | warn                    |
| `@typescript-eslint/no-empty-object-type`     | `complexity/noBannedTypes`                  | warn                    |
| `@typescript-eslint/no-explicit-any`          | `suspicious/noExplicitAny`                  | warn, error when strict |
| `@typescript-eslint/no-floating-promises`     | `nursery/noFloatingPromises`                | off, error when strict  |
| `@typescript-eslint/no-invalid-void-type`     | `suspicious/noConfusingVoidType`            | warn                    |
| `@typescript-eslint/no-misused-promises`      | `nursery/noMisusedPromises`                 | off, error when strict  |
| `@typescript-eslint/no-non-null-assertion`    | `style/noNonNullAssertion`                  | warn, error when strict |
| `@typescript-eslint/no-var-requires`          | `style/noCommonJs`                          | warn                    |
| `@typescript-eslint/prefer-for-of`            | `style/useForOf`                            | warn                    |
| `@typescript-eslint/prefer-optional-chain`    | `complexity/useOptionalChain`               | warn                    |
| `array-callback-return`                       | `suspicious/useIterableCallbackReturn`      | warn                    |
| `arrow-body-style`                            | `style/useConsistentArrowReturn`            | warn                    |
| `import/first`                                | `style/useImportsFirst`                     | error                   |
| `no-alert`                                    | `suspicious/noAlert`                        | error                   |
| `no-console`                                  | `suspicious/noConsole`                      | warn                    |
| `no-constant-binary-expression`               | `suspicious/noConstantBinaryExpressions`    | warn                    |
| `no-constant-condition`                       | `correctness/noConstantCondition`           | warn                    |
| `no-empty`                                    | `suspicious/noEmptyBlockStatements`         | warn, error when strict |
| `no-fallthrough`                              | `suspicious/noFallthroughSwitchClause`      | warn                    |
| `no-only-tests/no-only-tests`                 | `suspicious/noFocusedTests`                 | error                   |
| `no-nested-ternary`                           | `style/noNestedTernary`                     | warn                    |
| `no-new`                                      | `correctness/noUnusedInstantiation`         | warn                    |
| `no-unassigned-vars`                          | `suspicious/noUnassignedVariables`          | error                   |
| `no-undef`                                    | `correctness/noUndeclaredVariables`         | warn                    |
| `no-unused-expressions`                       | `suspicious/noUnusedExpressions`            | error                   |
| `no-unused-vars`                              | `correctness/noUnusedVariables`             | error                   |
| `no-use-before-define`                        | `correctness/noInvalidUseBeforeDeclaration` | warn                    |
| `no-useless-constructor`                      | `complexity/noUselessConstructor`           | warn                    |
| `no-useless-escape`                           | `complexity/noUselessEscapeInRegex`         | warn                    |
| `no-useless-return`                           | `complexity/noUselessReturn`                | warn                    |
| `no-var`                                      | `suspicious/noVar`                          | error                   |
| `no-void`                                     | `complexity/noVoid`                         | warn                    |
| `prefer-arrow-callback`                       | `complexity/useArrowFunction`               | warn                    |
| `prefer-const`                                | `style/useConst`                            | error                   |
| `prefer-regex-literals`                       | `complexity/useRegexLiterals`               | warn                    |
| `preserve-caught-error`                       | `style/useErrorCause`                       | error                   |
| `qwik/jsx-a`                                  | `a11y/useValidAnchor`                       | warn                    |
| `qwik/jsx-img`                                | `correctness/useImageSize`                  | warn                    |
| `qwik/jsx-no-script-url`                      | `security/noScriptUrl`                      | warn                    |
| `qwik/loader-location`                        | `correctness/useQwikLoaderLocation`         | warn                    |
| `qwik/no-react-props`                         | `suspicious/noReactSpecificProps`           | error                   |
| `qwik/no-use-visible-task`                    | `correctness/noQwikUseVisibleTask`          | warn                    |
| `qwik/prefer-classlist`                       | `correctness/useQwikClasslist`              | warn                    |
| `qwik/use-method-usage`                       | `correctness/useQwikMethodUsage`            | error                   |
| `qwik/valid-lexical-scope`                    | `correctness/useQwikValidLexicalScope`      | error                   |
| `react-refresh/only-export-components`        | `style/useComponentExportOnlyModules`       | warn                    |
| `turbo/no-undeclared-env-vars`                | `suspicious/noUndeclaredEnvVars`            | error                   |
| `unicorn/no-lonely-if`                        | `style/useCollapsedIf`                      | warn                    |
| `unicorn/no-negated-condition`                | `style/noNegationElse`                      | warn                    |
| `unicorn/no-useless-undefined`                | `complexity/noUselessUndefined`             | warn                    |
| `unicorn/prefer-array-flat-map`               | `complexity/useFlatMap`                     | warn                    |
| `unicorn/prefer-array-some`                   | `complexity/useArraySome`                   | warn                    |
| `unicorn/prefer-number-properties`            | `style/useNumberNamespace`                  | warn                    |
| `unicorn/prefer-string-slice`                 | `style/noSubstr`                            | warn                    |
| `unicorn/prefer-string-trim-start-end`        | `style/useTrimStartEnd`                     | warn                    |
| `unicorn/throw-new-error`                     | `style/useThrowNewError`                    | warn                    |
| `unused-imports/no-unused-imports`            | `correctness/noUnusedImports`               | warn, error when strict |
| `valid-typeof`                                | `correctness/useValidTypeof`                | warn                    |
| `vitest/consistent-test-it`                   | `style/useConsistentTestIt`                 | warn                    |
| `vitest/expect-expect`                        | `suspicious/useExpect`                      | error                   |
| `vitest/max-nested-describe`                  | `complexity/noExcessiveNestedTestSuites`    | error                   |
| `vitest/no-disabled-tests`                    | `suspicious/noSkippedTests`                 | warn, error when strict |
| `vitest/no-identical-title`                   | `suspicious/noIdenticalTestTitle`           | error                   |
| `vue/multi-word-component-names`              | `style/useVueMultiWordComponentNames`       | warn                    |

## Other names for the same check

These work in a policy and set the rule they stand for.

| Old rule                                     | Sets                                      |
| -------------------------------------------- | ----------------------------------------- |
| `@eslint-react/exhaustive-deps`              | `react-hooks/exhaustive-deps`             |
| `@eslint-react/no-array-index-key`           | `react/no-array-index-key`                |
| `@eslint-react/no-missing-key`               | `react/jsx-key`                           |
| `@typescript-eslint/no-empty-function`       | `no-empty`                                |
| `@typescript-eslint/no-unsafe-function-type` | `@typescript-eslint/no-empty-object-type` |
| `@typescript-eslint/no-unused-vars`          | `no-unused-vars`                          |
| `@typescript-eslint/no-useless-constructor`  | `no-useless-constructor`                  |
| `@typescript-eslint/no-wrapper-object-types` | `@typescript-eslint/no-empty-object-type` |
| `@typescript-eslint/require-await`           | `require-await`                           |
| `qwik/jsx-key`                               | `react/jsx-key`                           |
| `unicorn/no-for-loop`                        | `@typescript-eslint/prefer-for-of`        |
| `vitest/no-focused-tests`                    | `no-only-tests/no-only-tests`             |
| `vue/no-unused-vars`                         | `no-unused-vars`                          |

## On only under strict

Biome has these rules but still marks them as unstable (its `nursery` group), so the default standard leaves them off.

| Rule                                               | Biome rule                           | Level when strict |
| -------------------------------------------------- | ------------------------------------ | ----------------- |
| `@typescript-eslint/no-dynamic-delete`             | `nursery/noDynamicDelete`            | warn              |
| `@typescript-eslint/no-floating-promises`          | `nursery/noFloatingPromises`         | error             |
| `@typescript-eslint/no-misused-promises`           | `nursery/noMisusedPromises`          | error             |
| `@typescript-eslint/no-unnecessary-type-assertion` | `nursery/noUselessTypeAssertion`     | warn              |
| `@typescript-eslint/no-unsafe-return`              | `nursery/noUnsafeReturn`             | error             |
| `@typescript-eslint/prefer-nullish-coalescing`     | `nursery/useNullishCoalescing`       | warn              |
| `func-style`                                       | `nursery/useConsistentFunctionStyle` | warn              |
| `import/no-self-import`                            | `nursery/noSelfImport`               | error             |
| `max-depth`                                        | `nursery/noExcessiveNestedBlocks`    | warn              |
| `no-useless-assignment`                            | `nursery/noUselessAssignment`        | error             |
| `prefer-promise-reject-errors`                     | `nursery/usePromiseRejectErrors`     | warn              |
| `svelte/no-at-html-tags`                           | `nursery/noSvelteAtHtmlTags`         | warn              |
| `svelte/require-each-key`                          | `nursery/useSvelteRequireEachKey`    | warn              |
| `unicorn/catch-error-name`                         | `nursery/useCatchErrorName`          | warn              |
| `unicorn/no-useless-spread`                        | `nursery/noUselessSpread`            | warn              |
| `unicorn/prefer-includes`                          | `nursery/useIncludes`                | warn              |
| `vue/block-order`                                  | `nursery/useVueBlockOrder`           | warn              |
| `vue/no-mutating-props`                            | `nursery/noVueMutatingProps`         | warn              |
| `vue/require-default-prop`                         | `nursery/useVueDefaultProp`          | warn              |
| `vue/require-prop-types`                           | `nursery/useVueTypedProps`           | warn              |

## Replaced by the formatter or by import sorting

Biome's formatter owns layout and its import sorting owns import order, so these rules have nothing left to check. Three of them expressed preferences the formatter does not enforce: `@stylistic/padding-line-between-statements`, `@stylistic/lines-around-comment` and `@stylistic/multiline-comment-style`.

`@stylistic/array-element-newline`, `@stylistic/arrow-parens`, `@stylistic/brace-style`, `@stylistic/comma-dangle`, `@stylistic/dot-location`, `@stylistic/function-call-argument-newline`, `@stylistic/function-paren-newline`, `@stylistic/implicit-arrow-linebreak`, `@stylistic/indent`, `@stylistic/jsx-closing-bracket-location`, `@stylistic/jsx-closing-tag-location`, `@stylistic/jsx-indent`, `@stylistic/jsx-indent-props`, `@stylistic/jsx-one-expression-per-line`, `@stylistic/jsx-tag-spacing`, `@stylistic/lines-around-comment`, `@stylistic/max-len`, `@stylistic/max-statements-per-line`, `@stylistic/member-delimiter-style`, `@stylistic/multiline-comment-style`, `@stylistic/multiline-ternary`, `@stylistic/no-extra-parens`, `@stylistic/no-extra-semi`, `@stylistic/no-multi-spaces`, `@stylistic/object-curly-spacing`, `@stylistic/object-property-newline`, `@stylistic/operator-linebreak`, `@stylistic/padded-blocks`, `@stylistic/padding-line-between-statements`, `@stylistic/quote-props`, `@stylistic/quotes`, `@stylistic/semi`, `@typescript-eslint/indent`, `operator-linebreak`, `prettier/prettier`, `simple-import-sort/exports`, `simple-import-sort/imports`, `qwik/unused-server`, `vue/html-self-closing`

## No dependency-free home yet

Biome has no equivalent for these. Under ESLint they still work if the project installs the plugin and names the rule in its policy; pawl passes unknown rule names through to ESLint.

| Plugin                    | Rules | Names                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------- | ----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| @stencil-community        |    18 | `async-methods`, `ban-prefix`, `decorators-context`, `decorators-style`, `element-type`, `host-data-deprecated`, `methods-must-be-public`, `no-unused-watch`, `own-methods-must-be-private`, `own-props-must-be-private`, `prefer-vdom-listener`, `props-must-be-public`, `props-must-be-readonly`, `render-returns-host`, `required-jsdoc`, `reserved-member-names`, `single-export`, `strict-mutable` |
| unicorn                   |    13 | `consistent-destructuring`, `consistent-function-scoping`, `no-abusive-eslint-disable`, `no-typeof-undefined`, `prefer-array-find`, `prefer-array-flat`, `prefer-logical-operator-over-ternary`, `prefer-optional-catch-binding`, `prefer-spread`, `prefer-string-replace-all`, `prefer-string-starts-ends-with`, `prefer-switch`, `prefer-ternary`                                                     |
| zod                       |     9 | `array-style`, `prefer-enum-over-literal-union`, `prefer-loose-object`, `prefer-meta`, `prefer-meta-last`, `prefer-nullish`, `prefer-strict-object`, `prefer-string-schema-with-trim`, `prefer-trim-before-string-length-checks`                                                                                                                                                                        |
| @typescript-eslint        |     8 | `await-thenable`, `no-unsafe-argument`, `no-unsafe-assignment`, `no-unsafe-call`, `no-unsafe-member-access`, `no-unused-expressions`, `restrict-template-expressions`, `unbound-method`                                                                                                                                                                                                                 |
| markdown                  |     7 | `fenced-code-language`, `heading-increment`, `no-duplicate-headings`, `no-empty-links`, `no-html`, `no-invalid-label-refs`, `no-missing-label-refs`                                                                                                                                                                                                                                                     |
| testing-library           |     7 | `await-async-queries`, `no-await-sync-queries`, `no-debugging-utils`, `no-dom-import`, `no-unnecessary-act`, `prefer-find-by`, `prefer-screen-queries`                                                                                                                                                                                                                                                  |
| @angular-eslint           |     6 | `component-class-suffix`, `directive-class-suffix`, `no-empty-lifecycle-method`, `no-output-native`, `use-lifecycle-interface`, `use-pipe-transform-interface`                                                                                                                                                                                                                                          |
| ESLint core               |     6 | `brace-style`, `comma-dangle`, `no-multi-spaces`, `no-restricted-syntax`, `quote-props`, `space-before-function-paren`                                                                                                                                                                                                                                                                                  |
| n                         |     4 | `no-extraneous-import`, `no-missing-import`, `no-missing-require`, `no-unpublished-import`                                                                                                                                                                                                                                                                                                              |
| regexp                    |     4 | `no-super-linear-backtracking`, `no-unused-capturing-group`, `no-useless-escape`, `prefer-character-class`                                                                                                                                                                                                                                                                                              |
| @darraghor/nestjs-typed   |     3 | `api-method-should-specify-api-response`, `api-property-returning-array-should-set-array`, `injectable-should-be-provided`                                                                                                                                                                                                                                                                              |
| import                    |     3 | `export`, `no-duplicates`, `no-relative-packages`                                                                                                                                                                                                                                                                                                                                                       |
| jsdoc                     |     3 | `require-param-type`, `require-returns`, `require-returns-type`                                                                                                                                                                                                                                                                                                                                         |
| vitest                    |     3 | `prefer-to-be`, `prefer-to-have-length`, `valid-expect`                                                                                                                                                                                                                                                                                                                                                 |
| @eslint-react             |     2 | `dom-no-unknown-property`, `no-unstable-default-props`                                                                                                                                                                                                                                                                                                                                                  |
| perfectionist             |     2 | `sort-imports`, `sort-named-imports`                                                                                                                                                                                                                                                                                                                                                                    |
| promise                   |     2 | `always-return`, `catch-or-return`                                                                                                                                                                                                                                                                                                                                                                      |
| vue                       |     2 | `component-definition-name-casing`, `padding-line-between-blocks`                                                                                                                                                                                                                                                                                                                                       |
| yml                       |     2 | `no-empty-mapping-value`, `no-empty-sequence-entry`                                                                                                                                                                                                                                                                                                                                                     |
| @cspell                   |     1 | `spellchecker`                                                                                                                                                                                                                                                                                                                                                                                          |
| @graphql-eslint           |     1 | `no-unreachable-types`                                                                                                                                                                                                                                                                                                                                                                                  |
| @next/next                |     1 | `no-html-link-for-pages`                                                                                                                                                                                                                                                                                                                                                                                |
| i18next                   |     1 | `no-literal-string`                                                                                                                                                                                                                                                                                                                                                                                     |
| jsonc                     |     1 | `sort-keys`                                                                                                                                                                                                                                                                                                                                                                                             |
| n/no-unsupported-features |     1 | `node-builtins`                                                                                                                                                                                                                                                                                                                                                                                         |
| nuxt                      |     1 | `prefer-import-meta`                                                                                                                                                                                                                                                                                                                                                                                    |
| qwik                      |     1 | `no-async-prevent-default`                                                                                                                                                                                                                                                                                                                                                                              |
| tsdoc                     |     1 | `syntax`                                                                                                                                                                                                                                                                                                                                                                                                |

## Left out on purpose

| Rule                                          | Why                                    |
| --------------------------------------------- | -------------------------------------- |
| `no-restricted-imports`                       | Needs project-specific options         |
| `@html-eslint/no-inline-styles`               | Would also fire on JSX style props     |
| `@html-eslint/require-button-type`            | Covered through the React rule         |
| `no-irregular-whitespace`                     | The old config only ever turned it off |
| `@typescript-eslint/no-unnecessary-condition` | The old config only ever turned it off |
| `n/no-process-env`                            | The old config only ever turned it off |
| `n/no-process-exit`                           | The old config only ever turned it off |

## Options

Three rules carry options from the old config, for both engines: `no-unused-vars` (ignore rest siblings; under ESLint also the `^_` patterns), `@typescript-eslint/consistent-type-imports` (inline `type` specifiers) and `vitest/consistent-test-it` (`test` at the top level, `it` inside `describe`). Other options were not carried over.
