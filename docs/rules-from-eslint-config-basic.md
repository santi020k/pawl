# Rules carried over from eslint-config-basic

How each rule that `@santi020k/eslint-config-basic` configured maps into pawl. The mapping comes from Biome's own `biome migrate eslint`, run one rule at a time against Biome 2.6.8, so it reflects what Biome itself considers equivalent. Rules Biome has no equivalent for were checked against Oxlint 1.94.0's own rule list.

Only the rules the old config set explicitly are covered here. Rules it inherited from plugin presets (for example `eslint:recommended`) were not listed one by one; Biome's `recommended` preset is on in pawl and covers much of that ground.

## Summary

| Outcome                                                    |   Rules |
| ---------------------------------------------------------- | ------: |
| In the pawl catalog, enforced by Biome with no plugin      |      70 |
| In the catalog as another name for a rule above            |      17 |
| In the catalog, on only under `strict` (unstable in Biome) |      26 |
| In the catalog, enforced by Oxlint (no Biome equivalent)   |      16 |
| Checked by pawl itself: a guard or a Markdown check        |      17 |
| Replaced by the formatter or by import sorting             |      41 |
| No dependency-free home yet                                |      55 |
| Left out on purpose                                        |      18 |
| **Total configured in eslint-config-basic**                | **260** |

## Enforced by Biome

Levels are the ones the old config used. Where it used a stronger level in its strict mode, that level applies under `strict: true`.

| Rule                                          | Biome rule                                  | Level                   |
| --------------------------------------------- | ------------------------------------------- | ----------------------- |
| `array-callback-return`                       | `suspicious/useIterableCallbackReturn`      | warn                    |
| `arrow-body-style`                            | `style/useConsistentArrowReturn`            | warn                    |
| `@eslint-react/dom-no-missing-button-type`    | `a11y/useButtonType`                        | warn                    |
| `@eslint-react/dom-no-unsafe-target-blank`    | `security/noBlankTarget`                    | warn                    |
| `import/first`                                | `style/useImportsFirst`                     | error                   |
| `no-alert`                                    | `suspicious/noAlert`                        | error                   |
| `no-console`                                  | `suspicious/noConsole`                      | warn                    |
| `no-constant-binary-expression`               | `suspicious/noConstantBinaryExpressions`    | warn                    |
| `no-constant-condition`                       | `correctness/noConstantCondition`           | warn                    |
| `no-empty`                                    | `suspicious/noEmptyBlockStatements`         | warn, error when strict |
| `no-fallthrough`                              | `suspicious/noFallthroughSwitchClause`      | warn                    |
| `no-nested-ternary`                           | `style/noNestedTernary`                     | warn                    |
| `no-new`                                      | `correctness/noUnusedInstantiation`         | warn                    |
| `no-only-tests/no-only-tests`                 | `suspicious/noFocusedTests`                 | error                   |
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
| `@typescript-eslint/ban-ts-comment`           | `suspicious/noTsIgnore`                     | warn, error when strict |
| `@typescript-eslint/consistent-type-exports`  | `style/useExportType`                       | warn                    |
| `@typescript-eslint/consistent-type-imports`  | `style/useImportType`                       | warn, error when strict |
| `@typescript-eslint/no-deprecated`            | `suspicious/noDeprecatedImports`            | warn                    |
| `@typescript-eslint/no-duplicate-enum-values` | `suspicious/noDuplicateEnumValues`          | warn                    |
| `@typescript-eslint/no-empty-object-type`     | `complexity/noBannedTypes`                  | warn                    |
| `@typescript-eslint/no-explicit-any`          | `suspicious/noExplicitAny`                  | warn, error when strict |
| `@typescript-eslint/no-invalid-void-type`     | `suspicious/noConfusingVoidType`            | warn                    |
| `@typescript-eslint/no-non-null-assertion`    | `style/noNonNullAssertion`                  | warn, error when strict |
| `@typescript-eslint/no-var-requires`          | `style/noCommonJs`                          | warn                    |
| `@typescript-eslint/prefer-for-of`            | `style/useForOf`                            | warn                    |
| `@typescript-eslint/prefer-optional-chain`    | `complexity/useOptionalChain`               | warn                    |
| `unicorn/no-lonely-if`                        | `style/useCollapsedIf`                      | warn                    |
| `unicorn/no-negated-condition`                | `style/noNegationElse`                      | warn                    |
| `unicorn/no-useless-undefined`                | `complexity/noUselessUndefined`             | warn                    |
| `unicorn/prefer-array-find`                   | `complexity/useArrayFind`                   | warn                    |
| `unicorn/prefer-array-flat-map`               | `complexity/useFlatMap`                     | warn                    |
| `unicorn/prefer-array-some`                   | `complexity/useArraySome`                   | warn                    |
| `unicorn/prefer-number-properties`            | `style/useNumberNamespace`                  | warn                    |
| `unicorn/prefer-optional-catch-binding`       | `complexity/noUselessCatchBinding`          | warn                    |
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
| `n/no-extraneous-import`                     | `import/no-extraneous-dependencies`       |
| `n/no-missing-import`                        | `import/no-unresolved`                    |
| `qwik/jsx-key`                               | `react/jsx-key`                           |
| `regexp/no-useless-escape`                   | `no-useless-escape`                       |
| `@typescript-eslint/no-empty-function`       | `no-empty`                                |
| `@typescript-eslint/no-unsafe-function-type` | `@typescript-eslint/no-empty-object-type` |
| `@typescript-eslint/no-unused-expressions`   | `no-unused-expressions`                   |
| `@typescript-eslint/no-unused-vars`          | `no-unused-vars`                          |
| `@typescript-eslint/no-useless-constructor`  | `no-useless-constructor`                  |
| `@typescript-eslint/no-wrapper-object-types` | `@typescript-eslint/no-empty-object-type` |
| `@typescript-eslint/require-await`           | `require-await`                           |
| `unicorn/no-for-loop`                        | `@typescript-eslint/prefer-for-of`        |
| `vitest/no-focused-tests`                    | `no-only-tests/no-only-tests`             |
| `vue/no-unused-vars`                         | `no-unused-vars`                          |

## On only under strict

Biome has these rules but still marks them as unstable (its `nursery` group), so the default standard leaves them off.

| Rule                                               | Biome rule                               | Level when strict |
| -------------------------------------------------- | ---------------------------------------- | ----------------- |
| `@eslint-react/no-unstable-default-props`          | `nursery/noReactObjectTypeAsDefaultProp` | warn              |
| `func-style`                                       | `nursery/useConsistentFunctionStyle`     | warn              |
| `import/no-self-import`                            | `nursery/noSelfImport`                   | error             |
| `markdown/fenced-code-language`                    | `nursery/useFencedCodeLanguage`          | error             |
| `markdown/heading-increment`                       | `nursery/useConsistentHeadingLevel`      | error             |
| `max-depth`                                        | `nursery/noExcessiveNestedBlocks`        | warn              |
| `no-useless-assignment`                            | `nursery/noUselessAssignment`            | error             |
| `prefer-promise-reject-errors`                     | `nursery/usePromiseRejectErrors`         | warn              |
| `svelte/no-at-html-tags`                           | `nursery/noSvelteAtHtmlTags`             | warn              |
| `svelte/require-each-key`                          | `nursery/useSvelteRequireEachKey`        | warn              |
| `@typescript-eslint/await-thenable`                | `nursery/useAwaitThenable`               | error             |
| `@typescript-eslint/no-dynamic-delete`             | `nursery/noDynamicDelete`                | warn              |
| `@typescript-eslint/no-floating-promises`          | `nursery/noFloatingPromises`             | error             |
| `@typescript-eslint/no-misused-promises`           | `nursery/noMisusedPromises`              | error             |
| `@typescript-eslint/no-unnecessary-type-assertion` | `nursery/noUselessTypeAssertion`         | warn              |
| `@typescript-eslint/no-unsafe-return`              | `nursery/noUnsafeReturn`                 | error             |
| `@typescript-eslint/prefer-nullish-coalescing`     | `nursery/useNullishCoalescing`           | warn              |
| `unicorn/catch-error-name`                         | `nursery/useCatchErrorName`              | warn              |
| `unicorn/no-useless-spread`                        | `nursery/noUselessSpread`                | warn              |
| `unicorn/prefer-includes`                          | `nursery/useIncludes`                    | warn              |
| `unicorn/prefer-string-starts-ends-with`           | `nursery/useStringStartsEndsWith`        | warn              |
| `vue/block-order`                                  | `nursery/useVueBlockOrder`               | warn              |
| `vue/no-mutating-props`                            | `nursery/noVueMutatingProps`             | warn              |
| `vue/require-default-prop`                         | `nursery/useVueDefaultProp`              | warn              |
| `vue/require-prop-types`                           | `nursery/useVueTypedProps`               | warn              |
| `yml/no-empty-sequence-entry`                      | `nursery/noYamlEmptySequenceEntries`     | error             |

## Replaced by the formatter or by import sorting

Biome's formatter owns layout and its import sorting owns import order, so these rules have nothing left to check. Three of them expressed preferences the formatter does not enforce: `@stylistic/padding-line-between-statements`, `@stylistic/lines-around-comment` and `@stylistic/multiline-comment-style`.

`@stylistic/array-element-newline`, `@stylistic/arrow-parens`, `@stylistic/brace-style`, `@stylistic/comma-dangle`, `@stylistic/dot-location`, `@stylistic/function-call-argument-newline`, `@stylistic/function-paren-newline`, `@stylistic/implicit-arrow-linebreak`, `@stylistic/indent`, `@stylistic/jsx-closing-bracket-location`, `@stylistic/jsx-closing-tag-location`, `@stylistic/jsx-indent`, `@stylistic/jsx-indent-props`, `@stylistic/jsx-one-expression-per-line`, `@stylistic/jsx-tag-spacing`, `@stylistic/lines-around-comment`, `@stylistic/max-len`, `@stylistic/max-statements-per-line`, `@stylistic/member-delimiter-style`, `@stylistic/multiline-comment-style`, `@stylistic/multiline-ternary`, `@stylistic/no-extra-parens`, `@stylistic/no-extra-semi`, `@stylistic/no-multi-spaces`, `@stylistic/object-curly-spacing`, `@stylistic/object-property-newline`, `@stylistic/operator-linebreak`, `@stylistic/padded-blocks`, `@stylistic/padding-line-between-statements`, `@stylistic/quote-props`, `@stylistic/quotes`, `@stylistic/semi`, `@typescript-eslint/indent`, `operator-linebreak`, `prettier/prettier`, `simple-import-sort/exports`, `simple-import-sort/imports`, `qwik/unused-server`, `vue/html-self-closing`, `perfectionist/sort-imports`, `perfectionist/sort-named-imports`

## Enforced by Oxlint

Biome has no equivalent for these, and Oxlint enforces them natively, so they are in the catalog with no Biome rule. Where Oxlint is the linter they run with no plugin. Under ESLint they need the plugin; with Biome as the linter they run only when ESLint is there with that plugin's pack, or when the policy names the rule.

| Rule                                           | Oxlint rule                                    | Level                 |
| ---------------------------------------------- | ---------------------------------------------- | --------------------- |
| `import/export`                                | `import/export`                                | off, warn when strict |
| `import/no-duplicates`                         | `import/no-duplicates`                         | warn                  |
| `promise/always-return`                        | `promise/always-return`                        | warn                  |
| `promise/catch-or-return`                      | `promise/catch-or-return`                      | warn                  |
| `unicorn/consistent-function-scoping`          | `unicorn/consistent-function-scoping`          | warn                  |
| `unicorn/no-abusive-eslint-disable`            | `unicorn/no-abusive-eslint-disable`            | warn                  |
| `unicorn/no-typeof-undefined`                  | `unicorn/no-typeof-undefined`                  | warn                  |
| `unicorn/prefer-array-flat`                    | `unicorn/prefer-array-flat`                    | warn                  |
| `unicorn/prefer-logical-operator-over-ternary` | `unicorn/prefer-logical-operator-over-ternary` | warn                  |
| `unicorn/prefer-spread`                        | `unicorn/prefer-spread`                        | warn                  |
| `unicorn/prefer-string-replace-all`            | `unicorn/prefer-string-replace-all`            | warn                  |
| `unicorn/prefer-ternary`                       | `unicorn/prefer-ternary`                       | warn                  |
| `vitest/prefer-to-be`                          | `vitest/prefer-to-be`                          | warn                  |
| `vitest/prefer-to-have-length`                 | `vitest/prefer-to-have-length`                 | warn                  |
| `vitest/valid-expect`                          | `vitest/valid-expect`                          | error                 |
| `vue/component-definition-name-casing`         | `vue/component-definition-name-casing`         | warn                  |

Oxlint still marks `import/export` as unstable (its `nursery` category), so it is on only under strict. Biome's import sorting already merges duplicate imports, so `import/no-duplicates` adds nothing where Biome sorts imports.

## Checked by pawl itself

These need no engine and no plugin. The guards switch on when the project depends on the library; each code pattern is written both as an ESLint selector and as a GritQL rule for Biome. The Markdown checks are line scans, like the Docker checks. The matching pack rules are off, so nothing is reported twice.

| Rule                                          | Now                                                     | Level |
| --------------------------------------------- | ------------------------------------------------------- | ----- |
| `markdown/no-duplicate-headings`              | `pawl/markdown-no-duplicate-headings`                   | off   |
| `markdown/no-empty-links`                     | `pawl/markdown-no-empty-links`                          | error |
| `markdown/no-invalid-label-refs`              | `pawl/markdown-no-invalid-label-refs`                   | error |
| `markdown/no-missing-label-refs`              | `pawl/markdown-no-missing-label-refs`                   | off   |
| `nuxt/prefer-import-meta`                     | `pawl/nuxt` guard                                       | error |
| `testing-library/no-await-sync-queries`       | `pawl/testing-library` guard                            | error |
| `testing-library/no-debugging-utils`          | `pawl/testing-library-debug` guard                      | warn  |
| `testing-library/no-dom-import`               | `pawl/testing-library-dom` guard, an import restriction | error |
| `testing-library/prefer-find-by`              | `pawl/testing-library-find-by` guard                    | warn  |
| `testing-library/prefer-screen-queries`       | `pawl/testing-library` guard                            | error |
| `zod/prefer-enum-over-literal-union`          | `pawl/zod` guard                                        | error |
| `zod/prefer-loose-object`                     | `pawl/zod` guard                                        | error |
| `zod/prefer-meta`                             | `pawl/zod` guard                                        | error |
| `zod/prefer-meta-last`                        | `pawl/zod` guard                                        | error |
| `zod/prefer-nullish`                          | `pawl/zod` guard                                        | error |
| `zod/prefer-strict-object`                    | `pawl/zod` guard                                        | error |
| `zod/prefer-trim-before-string-length-checks` | `pawl/zod` guard                                        | error |

The guards match less than the plugins do, on purpose, to stay free of false positives: the Zod object checks need the factory written as `z` and the modifier right after `z.object(...)`, the `.describe()` check needs a call chain that starts at `z`, the literal union check needs every member to be `z.literal()` of a string, the Testing Library checks look only at queries taken from `render()` and at `waitFor()` with one callback that returns a query, and the debugging check leaves a bare `debug()` alone. The Markdown checks skip code blocks, code spans, HTML comments and front matter; `no-duplicate-headings` compares headings across the whole document, as the plugin does by default.

## No dependency-free home yet

Neither Biome nor Oxlint has an equivalent for these, and pawl has no check of its own for them yet. Many need type information or a framework's own parser. Under ESLint they work through their packs once the project installs the plugin, and a policy can name any of them; pawl passes unknown rule names through to ESLint.

| Plugin                  | Rules | Names                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------- | ----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| stencil                 |    18 | `async-methods`, `ban-prefix`, `decorators-context`, `decorators-style`, `element-type`, `host-data-deprecated`, `methods-must-be-public`, `no-unused-watch`, `own-methods-must-be-private`, `own-props-must-be-private`, `prefer-vdom-listener`, `props-must-be-public`, `props-must-be-readonly`, `render-returns-host`, `required-jsdoc`, `reserved-member-names`, `single-export`, `strict-mutable` |
| @angular-eslint         |     6 | `component-class-suffix`, `directive-class-suffix`, `no-empty-lifecycle-method`, `no-output-native`, `use-lifecycle-interface`, `use-pipe-transform-interface`                                                                                                                                                                                                                                          |
| @typescript-eslint      |     6 | `no-unsafe-argument`, `no-unsafe-assignment`, `no-unsafe-call`, `no-unsafe-member-access`, `restrict-template-expressions`, `unbound-method`                                                                                                                                                                                                                                                            |
| ESLint core             |     6 | `brace-style`, `comma-dangle`, `no-multi-spaces`, `no-restricted-syntax`, `quote-props`, `space-before-function-paren`                                                                                                                                                                                                                                                                                  |
| testing-library         |     2 | `await-async-queries`, `no-unnecessary-act`                                                                                                                                                                                                                                                                                                                                                             |
| zod                     |     2 | `array-style`, `prefer-string-schema-with-trim`                                                                                                                                                                                                                                                                                                                                                         |
| @darraghor/nestjs-typed |     3 | `api-method-should-specify-api-response`, `api-property-returning-array-should-set-array`, `injectable-should-be-provided`                                                                                                                                                                                                                                                                              |
| regexp                  |     3 | `no-super-linear-backtracking`, `no-unused-capturing-group`, `prefer-character-class`                                                                                                                                                                                                                                                                                                                   |
| unicorn                 |     2 | `consistent-destructuring`, `prefer-switch`                                                                                                                                                                                                                                                                                                                                                             |
| @cspell                 |     1 | `spellchecker`                                                                                                                                                                                                                                                                                                                                                                                          |
| @graphql-eslint         |     1 | `no-unreachable-types`                                                                                                                                                                                                                                                                                                                                                                                  |
| import                  |     1 | `no-relative-packages`                                                                                                                                                                                                                                                                                                                                                                                  |
| jsonc                   |     1 | `sort-keys`                                                                                                                                                                                                                                                                                                                                                                                             |
| qwik                    |     1 | `no-async-prevent-default`                                                                                                                                                                                                                                                                                                                                                                              |
| tsdoc                   |     1 | `syntax`                                                                                                                                                                                                                                                                                                                                                                                                |
| vue                     |     1 | `padding-line-between-blocks`                                                                                                                                                                                                                                                                                                                                                                           |

## Left out on purpose

| Rule                                          | Why                                                                                                                          |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `no-restricted-imports`                       | Needs project-specific options                                                                                               |
| `@html-eslint/no-inline-styles`               | Would also fire on JSX style props                                                                                           |
| `@html-eslint/require-button-type`            | Covered through the React rule                                                                                               |
| `no-irregular-whitespace`                     | The old config only ever turned it off                                                                                       |
| `@typescript-eslint/no-unnecessary-condition` | The old config only ever turned it off                                                                                       |
| `n/no-process-env`                            | The old config only ever turned it off                                                                                       |
| `n/no-process-exit`                           | The old config only ever turned it off                                                                                       |
| `@eslint-react/dom-no-unknown-property`       | The old config only ever turned it off                                                                                       |
| `@next/next/no-html-link-for-pages`           | The old config only ever turned it off                                                                                       |
| `jsdoc/require-param-type`                    | The old config only ever turned it off                                                                                       |
| `jsdoc/require-returns`                       | The old config only ever turned it off                                                                                       |
| `jsdoc/require-returns-type`                  | The old config only ever turned it off                                                                                       |
| `markdown/no-html`                            | The old config only ever turned it off                                                                                       |
| `n/no-missing-require`                        | The old config only ever turned it off                                                                                       |
| `n/no-unpublished-import`                     | The old config only ever turned it off                                                                                       |
| `n/no-unsupported-features/node-builtins`     | The old config only ever turned it off                                                                                       |
| `yml/no-empty-mapping-value`                  | Biome's version flags `workflow_dispatch:` in every GitHub workflow; the old config turned it off there                      |
| `i18next/no-literal-string`                   | Opt-in and noisy; Biome's `style/noJsxLiterals` takes different options. Use `biome:style/noJsxLiterals` or the i18next pack |

## Options

Three rules carry options from the old config, for both engines: `no-unused-vars` (ignore rest siblings; under ESLint also the `^_` patterns), `@typescript-eslint/consistent-type-imports` (inline `type` specifiers) and `vitest/consistent-test-it` (`test` at the top level, `it` inside `describe`). Other options were not carried over.
