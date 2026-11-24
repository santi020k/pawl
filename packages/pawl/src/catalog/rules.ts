import { type LanguageEngine, type Level } from '../types.ts'

/** What a rule is about. The tags in `GATED_TAGS` name a technology the project must use. */
export type RuleTag = 'core' | 'typescript' | 'imports' | 'tests' | 'formats' | 'pawl' | Technology

/**
 * Tags whose rules only apply to projects that use that technology.
 * Several of these rules judge code by naming alone and would misfire elsewhere.
 */
export const GATED_TAGS = [
  'react',
  'next',
  'react-native',
  'qwik',
  'solid',
  'vue',
  'svelte',
  'astro',
  'tailwind',
  'tanstack-query',
  'drizzle',
  'playwright',
  'turbo'
] as const

/** A technology with rules of its own, in pawl's catalog or in a Biome rule domain. */
export type Technology = (typeof GATED_TAGS)[number]

export const isGated = (tag: RuleTag): tag is Technology => (GATED_TAGS as readonly string[]).includes(tag)

/**
 * One rule of the standard.
 *
 * The neutral name is ESLint's name, because most developers already know it.
 * ESLint therefore needs no mapping; Biome's rule is named in `biome`.
 */
export interface RuleDef {
  name: string
  summary: string
  tag: RuleTag
  /** Level in the default standard. */
  level: Level
  /** Level when the policy is strict. Defaults to `level`. */
  strict?: Level
  /** Biome's rule as `group/name`, when Biome has one. Without one, Oxlint or an ESLint plugin enforces it. */
  biome?: string
  /** Other ESLint names for the same check. A policy may use any of them. */
  aliases?: string[]
  /** Options for each engine, where the standard needs them. */
  options?: { biome?: Record<string, unknown>; eslint?: unknown[] }
  /** The engine that enforces it still marks its rule as unstable, so it is only on in a strict policy. */
  nursery?: boolean
  /** The ESLint rule needs type information. */
  typeAware?: boolean
  /** Guards against a mistake coding agents make often. */
  guardrail?: boolean
  /** One line telling a person or an agent how to resolve it. */
  advice?: string
}

type Extra = Partial<Pick<RuleDef, 'strict' | 'aliases' | 'options' | 'nursery' | 'typeAware' | 'guardrail' | 'advice'>>

const rule = (
  tag: RuleTag,
  name: string,
  biome: string | undefined,
  level: Level,
  summary: string,
  extra: Extra = {}
): RuleDef => ({ name, summary, tag, level, ...(biome ? { biome } : {}), ...extra })

/**
 * The standard. It started from the rules of @santi020k/eslint-config-basic: every rule there
 * that Biome can enforce is here, at the level it had. See docs/rules-from-eslint-config-basic.md.
 */
export const RULES: readonly RuleDef[] = [
  // JavaScript
  rule('core', 'no-debugger', 'suspicious/noDebugger', 'error', 'No debugger statements.'),
  rule('core', 'no-unused-vars', 'correctness/noUnusedVariables', 'error', 'No unused variables.', {
    aliases: ['@typescript-eslint/no-unused-vars', 'vue/no-unused-vars'],
    advice: 'Remove the variable, or use it.',
    options: {
      biome: { ignoreRestSiblings: true },
      eslint: [{ args: 'after-used', argsIgnorePattern: '^_', ignoreRestSiblings: true, varsIgnorePattern: '^_' }]
    }
  }),
  rule('core', 'no-empty', 'suspicious/noEmptyBlockStatements', 'warn', 'No empty blocks.', {
    strict: 'error',
    guardrail: true,
    aliases: ['@typescript-eslint/no-empty-function'],
    advice: 'Handle the case, or explain in a comment inside the block why it is empty.'
  }),
  rule('core', 'no-eval', 'security/noGlobalEval', 'error', 'No eval().'),
  rule('core', 'no-with', 'suspicious/noWith', 'error', 'No with statements.'),
  rule('core', 'use-isnan', 'correctness/useIsNan', 'error', 'Use Number.isNaN() to test for NaN.'),
  rule('core', 'valid-typeof', 'correctness/useValidTypeof', 'warn', 'Compare typeof against valid strings.'),
  rule('core', 'no-unreachable', 'correctness/noUnreachable', 'error', 'No unreachable code.'),
  rule('core', 'no-sparse-arrays', 'suspicious/noSparseArray', 'error', 'No sparse arrays.'),
  rule('core', 'no-dupe-keys', 'suspicious/noDuplicateObjectKeys', 'error', 'No duplicate object keys.'),
  rule('core', 'no-duplicate-case', 'suspicious/noDuplicateCase', 'error', 'No duplicate case labels.'),
  rule('core', 'no-cond-assign', 'suspicious/noAssignInExpressions', 'error', 'No assignment inside expressions.'),
  rule('core', 'no-empty-pattern', 'correctness/noEmptyPattern', 'error', 'No empty destructuring patterns.'),
  rule(
    'core',
    'no-async-promise-executor',
    'suspicious/noAsyncPromiseExecutor',
    'error',
    'No async Promise executors.'
  ),
  rule('core', 'no-unused-expressions', 'suspicious/noUnusedExpressions', 'error', 'No unused expressions.', {
    aliases: ['@typescript-eslint/no-unused-expressions']
  }),
  rule('core', 'no-unsafe-finally', 'correctness/noUnsafeFinally', 'error', 'No control flow in finally blocks.'),
  rule('core', 'no-constant-condition', 'correctness/noConstantCondition', 'warn', 'No constant conditions.'),
  rule('core', 'no-redeclare', 'suspicious/noRedeclare', 'error', 'No redeclared variables.'),
  rule(
    'core',
    'no-prototype-builtins',
    'suspicious/noPrototypeBuiltins',
    'error',
    'No direct calls to Object.prototype methods.'
  ),
  rule(
    'core',
    'no-fallthrough',
    'suspicious/noFallthroughSwitchClause',
    'warn',
    'No fallthrough between switch cases.'
  ),
  rule('core', 'no-self-compare', 'suspicious/noSelfCompare', 'error', 'No comparing a value with itself.'),
  rule('core', 'default-case-last', 'suspicious/useDefaultSwitchClauseLast', 'error', 'Put the default case last.'),
  rule('core', 'no-useless-catch', 'complexity/noUselessCatch', 'error', 'No catch blocks that only rethrow.', {
    guardrail: true
  }),
  rule('core', 'no-var', 'suspicious/noVar', 'error', 'Use let or const.'),
  rule('core', 'prefer-const', 'style/useConst', 'error', 'Use const for values that are never reassigned.'),
  rule('core', 'eqeqeq', 'suspicious/noDoubleEquals', 'error', 'Use === and !==.'),
  rule('core', 'no-console', 'suspicious/noConsole', 'warn', 'No console calls in shipped code.', {
    advice: 'Remove the call or use the project logger. CLI projects usually turn this rule off.'
  }),
  rule('core', 'no-alert', 'suspicious/noAlert', 'error', 'No alert, confirm or prompt.'),
  rule('core', 'no-param-reassign', 'style/noParameterAssign', 'warn', 'No reassigning function parameters.'),
  rule('core', 'no-else-return', 'style/noUselessElse', 'warn', 'No else after a return.'),
  rule(
    'core',
    'no-useless-constructor',
    'complexity/noUselessConstructor',
    'warn',
    'No empty or pass-through constructors.',
    { aliases: ['@typescript-eslint/no-useless-constructor'] }
  ),
  rule('core', 'no-useless-rename', 'complexity/noUselessRename', 'error', 'No renaming to the same name.'),
  rule('core', 'no-useless-escape', 'complexity/noUselessEscapeInRegex', 'warn', 'No unnecessary escapes.', {
    aliases: ['regexp/no-useless-escape']
  }),
  rule('core', 'no-useless-concat', 'complexity/noUselessStringConcat', 'warn', 'No concatenating two literals.'),
  rule('core', 'no-unneeded-ternary', 'complexity/noUselessTernary', 'warn', 'No ternary where a simpler form exists.'),
  rule('core', 'no-nested-ternary', 'style/noNestedTernary', 'warn', 'No nested ternaries.'),
  rule('core', 'no-undef-init', 'complexity/noUselessUndefinedInitialization', 'warn', 'No initializing to undefined.'),
  rule('core', 'prefer-template', 'style/useTemplate', 'warn', 'Use template literals over string concatenation.'),
  rule('core', 'prefer-arrow-callback', 'complexity/useArrowFunction', 'warn', 'Use arrow functions for callbacks.'),
  rule('core', 'prefer-exponentiation-operator', 'style/useExponentiationOperator', 'warn', 'Use ** over Math.pow().'),
  rule('core', 'operator-assignment', 'style/useShorthandAssign', 'warn', 'Use shorthand assignment operators.'),
  rule('core', 'default-param-last', 'style/useDefaultParameterLast', 'warn', 'Put default parameters last.'),
  rule('core', 'yoda', 'style/noYodaExpression', 'warn', 'Put the variable first in comparisons.'),
  rule('core', 'no-shadow', 'suspicious/noShadow', 'off', 'No shadowing a variable from an outer scope.', {
    strict: 'warn'
  }),
  rule('core', 'no-await-in-loop', 'performance/noAwaitInLoops', 'off', 'No await inside loops.', {
    strict: 'warn',
    advice:
      'Parallelize only independent operations. Keep browser interactions, ordered writes, polling and dependent pagination serial; document a narrow policy exception and test the required order.'
  }),
  rule('core', 'require-await', 'suspicious/useAwait', 'off', 'No async functions without await.', {
    strict: 'warn',
    aliases: ['@typescript-eslint/require-await']
  }),
  rule(
    'core',
    'array-callback-return',
    'suspicious/useIterableCallbackReturn',
    'warn',
    'Enforce consistent return values in iterable callbacks.'
  ),
  rule(
    'core',
    'arrow-body-style',
    'style/useConsistentArrowReturn',
    'warn',
    'Enforce consistent arrow function bodies.'
  ),
  rule(
    'core',
    'func-style',
    'nursery/useConsistentFunctionStyle',
    'off',
    'Enforce consistent use of function declarations or expressions assigned to variables.',
    { strict: 'warn', nursery: true }
  ),
  rule(
    'core',
    'max-depth',
    'nursery/noExcessiveNestedBlocks',
    'off',
    'Enforce a maximum depth that blocks can be nested.',
    { strict: 'warn', nursery: true }
  ),
  rule(
    'core',
    'no-constant-binary-expression',
    'suspicious/noConstantBinaryExpressions',
    'warn',
    "Disallow expressions where the operation doesn't affect the value."
  ),
  rule(
    'core',
    'no-new',
    'correctness/noUnusedInstantiation',
    'warn',
    'Disallow new operators outside of assignments or comparisons.'
  ),
  rule(
    'core',
    'no-unassigned-vars',
    'suspicious/noUnassignedVariables',
    'error',
    'Disallow let or var variables that are read but never assigned.'
  ),
  rule(
    'core',
    'no-undef',
    'correctness/noUndeclaredVariables',
    'warn',
    "Prevents the usage of variables that haven't been declared inside the document."
  ),
  rule(
    'core',
    'no-use-before-define',
    'correctness/noInvalidUseBeforeDeclaration',
    'warn',
    'Disallow the use of variables, function parameters, classes, and enums before their declaration.'
  ),
  rule(
    'core',
    'no-useless-assignment',
    'nursery/noUselessAssignment',
    'off',
    'Disallow assignments whose value is never read.',
    { strict: 'error', nursery: true }
  ),
  rule('core', 'no-useless-return', 'complexity/noUselessReturn', 'warn', 'Disallow redundant return statements.'),
  rule(
    'core',
    'no-void',
    'complexity/noVoid',
    'warn',
    'Disallow the use of void operators, which is not a familiar operator.'
  ),
  rule(
    'core',
    'prefer-promise-reject-errors',
    'nursery/usePromiseRejectErrors',
    'off',
    'Require Error objects as Promise rejection reasons.',
    { strict: 'warn', nursery: true }
  ),
  rule(
    'core',
    'prefer-regex-literals',
    'complexity/useRegexLiterals',
    'warn',
    'Enforce the use of the regular expression literals instead of the RegExp constructor if possible.'
  ),
  rule(
    'core',
    'preserve-caught-error',
    'style/useErrorCause',
    'error',
    'Enforce that new Error() is thrown with the original error as cause.'
  ),
  rule(
    'core',
    'unicorn/catch-error-name',
    'nursery/useCatchErrorName',
    'off',
    'Require a specific name for caught errors.',
    { strict: 'warn', nursery: true }
  ),
  rule(
    'core',
    'unicorn/no-lonely-if',
    'style/useCollapsedIf',
    'warn',
    'Enforce using single if instead of nested if clauses.'
  ),
  rule(
    'core',
    'unicorn/no-negated-condition',
    'style/noNegationElse',
    'warn',
    'Disallow negation in the condition of an if statement if it has an else clause.'
  ),
  rule(
    'core',
    'unicorn/no-useless-spread',
    'nursery/noUselessSpread',
    'off',
    'Disallow spread syntax that has no effect.',
    { strict: 'warn', nursery: true }
  ),
  rule(
    'core',
    'unicorn/no-useless-undefined',
    'complexity/noUselessUndefined',
    'warn',
    'Disallow the use of useless undefined.'
  ),
  rule(
    'core',
    'unicorn/prefer-array-flat-map',
    'complexity/useFlatMap',
    'warn',
    'Promotes the use of .flatMap() when map().flat() are used together.'
  ),
  rule(
    'core',
    'unicorn/prefer-array-some',
    'complexity/useArraySome',
    'warn',
    'Prefer Array.prototype.some() over verbose existence checks.'
  ),
  rule(
    'core',
    'unicorn/prefer-includes',
    'nursery/useIncludes',
    'off',
    'Prefer Array#includes() over Array#indexOf(), Array#lastIndexOf(), and Array#some() when checking for existence or non-existence.',
    { strict: 'warn', nursery: true }
  ),
  rule(
    'core',
    'unicorn/prefer-number-properties',
    'style/useNumberNamespace',
    'warn',
    'Use the Number properties instead of global ones.'
  ),
  rule(
    'core',
    'unicorn/prefer-string-slice',
    'style/noSubstr',
    'warn',
    'Enforce the use of String.slice() over String.substr() and String.substring().'
  ),
  rule(
    'core',
    'unicorn/prefer-string-trim-start-end',
    'style/useTrimStartEnd',
    'warn',
    'Enforce the use of String.trimStart() and String.trimEnd() over String.trimLeft() and String.trimRight().'
  ),
  rule('core', 'unicorn/throw-new-error', 'style/useThrowNewError', 'warn', 'Require new when throwing an error.'),
  rule(
    'core',
    'unicorn/prefer-optional-catch-binding',
    'complexity/noUselessCatchBinding',
    'warn',
    'Leave out a catch binding that is never used.'
  ),
  rule('core', 'unicorn/prefer-array-find', 'complexity/useArrayFind', 'warn', 'Use .find() over .filter()[0].'),
  rule(
    'core',
    'unicorn/prefer-string-starts-ends-with',
    'nursery/useStringStartsEndsWith',
    'off',
    'Use startsWith() and endsWith() over a regular expression or a slice comparison.',
    { strict: 'warn', nursery: true }
  ),
  // No Biome equivalent: Oxlint enforces these, or ESLint with eslint-plugin-unicorn.
  rule(
    'core',
    'unicorn/consistent-function-scoping',
    undefined,
    'warn',
    'Move a function to the outermost scope it can live in.'
  ),
  rule('core', 'unicorn/no-abusive-eslint-disable', undefined, 'warn', 'No disable comments that name no rule.', {
    advice: 'Name the rule the comment switches off, or fix the finding instead.'
  }),
  rule(
    'core',
    'unicorn/no-typeof-undefined',
    undefined,
    'warn',
    "Compare with undefined directly, not with typeof x === 'undefined'."
  ),
  rule('core', 'unicorn/prefer-array-flat', undefined, 'warn', 'Use .flat() over flattening an array by hand.'),
  rule(
    'core',
    'unicorn/prefer-logical-operator-over-ternary',
    undefined,
    'warn',
    'Use ?? or || over a ternary that repeats its condition.'
  ),
  rule(
    'core',
    'unicorn/prefer-spread',
    undefined,
    'warn',
    'Use spread over Array.from(), concat(), slice() and split("") for copies.'
  ),
  rule(
    'core',
    'unicorn/prefer-string-replace-all',
    undefined,
    'warn',
    'Use replaceAll() over replace() with a global regular expression.'
  ),
  rule(
    'core',
    'unicorn/prefer-ternary',
    undefined,
    'warn',
    'Use a ternary over an if-else that only assigns or returns.'
  ),
  rule('core', 'promise/always-return', undefined, 'warn', 'Return a value or throw in every then() callback.'),
  rule(
    'core',
    'promise/catch-or-return',
    undefined,
    'warn',
    'Handle the rejection of a promise with catch(), or return the promise.'
  ),

  // TypeScript
  rule('typescript', '@typescript-eslint/no-explicit-any', 'suspicious/noExplicitAny', 'warn', 'No explicit any.', {
    strict: 'error',
    guardrail: true,
    advice: 'Use a specific type, or unknown and narrow it.'
  }),
  rule(
    'typescript',
    '@typescript-eslint/no-non-null-assertion',
    'style/noNonNullAssertion',
    'warn',
    'No non-null assertions.',
    { strict: 'error', guardrail: true, advice: 'Check for null or undefined and handle it.' }
  ),
  rule('typescript', '@typescript-eslint/ban-ts-comment', 'suspicious/noTsIgnore', 'warn', 'No @ts-ignore.', {
    strict: 'error',
    guardrail: true,
    advice: 'Fix the type error. If it cannot be fixed, use @ts-expect-error with a reason.'
  }),
  rule(
    'typescript',
    '@typescript-eslint/consistent-type-imports',
    'style/useImportType',
    'warn',
    'Use import type for types.',
    { strict: 'error', options: { biome: { style: 'inlineType' }, eslint: [{ fixStyle: 'inline-type-imports' }] } }
  ),
  rule(
    'typescript',
    '@typescript-eslint/array-type',
    'style/useConsistentArrayType',
    'warn',
    'Use one array type syntax.'
  ),
  rule('typescript', '@typescript-eslint/no-namespace', 'style/noNamespace', 'error', 'No TypeScript namespaces.'),
  rule(
    'typescript',
    '@typescript-eslint/no-inferrable-types',
    'style/noInferrableTypes',
    'warn',
    'No type annotations the compiler infers.'
  ),
  rule(
    'typescript',
    '@typescript-eslint/prefer-as-const',
    'style/useAsConstAssertion',
    'error',
    'Use as const over a literal type assertion.'
  ),
  rule(
    'typescript',
    '@typescript-eslint/no-unsafe-declaration-merging',
    'suspicious/noUnsafeDeclarationMerging',
    'error',
    'No merging a class with an interface.'
  ),
  rule(
    'typescript',
    '@typescript-eslint/no-extra-non-null-assertion',
    'suspicious/noExtraNonNullAssertion',
    'error',
    'No repeated non-null assertions.'
  ),
  rule(
    'typescript',
    '@typescript-eslint/no-misused-new',
    'suspicious/noMisleadingInstantiator',
    'error',
    'No misleading new or constructor signatures.'
  ),
  rule(
    'typescript',
    '@typescript-eslint/prefer-namespace-keyword',
    'suspicious/useNamespaceKeyword',
    'error',
    'Use namespace over module.'
  ),
  rule(
    'typescript',
    '@typescript-eslint/prefer-optional-chain',
    'complexity/useOptionalChain',
    'warn',
    'Use optional chaining.',
    { typeAware: true }
  ),
  rule(
    'typescript',
    '@typescript-eslint/no-floating-promises',
    'nursery/noFloatingPromises',
    'off',
    'No unhandled promises.',
    {
      strict: 'error',
      typeAware: true,
      guardrail: true,
      nursery: true,
      advice: 'Await the promise, return it, or handle its rejection.'
    }
  ),
  rule(
    'typescript',
    '@typescript-eslint/no-misused-promises',
    'nursery/noMisusedPromises',
    'off',
    'No promises where a plain value is expected.',
    { strict: 'error', typeAware: true, nursery: true }
  ),
  rule(
    'typescript',
    '@typescript-eslint/consistent-type-exports',
    'style/useExportType',
    'warn',
    'Promotes the use of export type for types.',
    { typeAware: true }
  ),
  rule(
    'typescript',
    '@typescript-eslint/no-deprecated',
    'suspicious/noDeprecatedImports',
    'warn',
    'Restrict imports of deprecated exports.',
    { typeAware: true }
  ),
  rule(
    'typescript',
    '@typescript-eslint/no-duplicate-enum-values',
    'suspicious/noDuplicateEnumValues',
    'warn',
    'Disallow duplicate enum member values.'
  ),
  rule(
    'typescript',
    '@typescript-eslint/no-dynamic-delete',
    'nursery/noDynamicDelete',
    'off',
    'Disallow using the delete operator with a property name that is computed at runtime.',
    { strict: 'warn', nursery: true }
  ),
  rule(
    'typescript',
    '@typescript-eslint/no-empty-object-type',
    'complexity/noBannedTypes',
    'warn',
    'Disallow primitive type aliases and misleading types.',
    { aliases: ['@typescript-eslint/no-unsafe-function-type', '@typescript-eslint/no-wrapper-object-types'] }
  ),
  rule(
    'typescript',
    '@typescript-eslint/no-invalid-void-type',
    'suspicious/noConfusingVoidType',
    'warn',
    'Disallow void type outside of generic or return types.'
  ),
  rule(
    'typescript',
    '@typescript-eslint/no-unnecessary-type-assertion',
    'nursery/noUselessTypeAssertion',
    'off',
    "Disallow type assertions that don't change the type of an expression.",
    { strict: 'warn', typeAware: true, nursery: true }
  ),
  rule(
    'typescript',
    '@typescript-eslint/no-unsafe-return',
    'nursery/noUnsafeReturn',
    'off',
    'Disallow returning a value typed as any from a function.',
    { strict: 'error', typeAware: true, nursery: true }
  ),
  rule(
    'typescript',
    '@typescript-eslint/no-var-requires',
    'style/noCommonJs',
    'warn',
    'Disallow use of CommonJs module system in favor of ESM style imports.'
  ),
  rule(
    'typescript',
    '@typescript-eslint/prefer-for-of',
    'style/useForOf',
    'warn',
    'Prefer using for...of loops over standard for loops where possible.',
    { aliases: ['unicorn/no-for-loop'] }
  ),
  rule(
    'typescript',
    '@typescript-eslint/prefer-nullish-coalescing',
    'nursery/useNullishCoalescing',
    'off',
    'Enforce using the nullish coalescing operator (??) instead of logical or (||).',
    { strict: 'warn', typeAware: true, nursery: true }
  ),
  rule(
    'typescript',
    '@typescript-eslint/await-thenable',
    'nursery/useAwaitThenable',
    'off',
    'No awaiting a value that is not a promise.',
    { strict: 'error', typeAware: true, nursery: true }
  ),

  // React
  rule('react', 'react-hooks/rules-of-hooks', 'correctness/useHookAtTopLevel', 'error', 'Call hooks at the top level.'),
  rule(
    'react',
    'react-hooks/exhaustive-deps',
    'correctness/useExhaustiveDependencies',
    'warn',
    'List every dependency of a hook.',
    { aliases: ['@eslint-react/exhaustive-deps'] }
  ),
  rule('react', 'react/jsx-key', 'correctness/useJsxKeyInIterable', 'error', 'Give list items a key.', {
    aliases: ['@eslint-react/no-missing-key', 'qwik/jsx-key']
  }),
  rule('react', 'react/no-array-index-key', 'suspicious/noArrayIndexKey', 'warn', 'No array index as a key.', {
    aliases: ['@eslint-react/no-array-index-key']
  }),
  rule('react', 'react/no-danger', 'security/noDangerouslySetInnerHtml', 'warn', 'No dangerouslySetInnerHTML.'),
  rule('react', 'react/no-children-prop', 'correctness/noChildrenProp', 'error', 'No children passed as a prop.'),
  rule('react', 'react/jsx-no-duplicate-props', 'suspicious/noDuplicateJsxProps', 'error', 'No duplicate JSX props.'),
  rule('react', 'react/jsx-no-comment-textnodes', 'suspicious/noCommentText', 'error', 'No comments rendered as text.'),
  rule('react', 'react/jsx-no-useless-fragment', 'complexity/noUselessFragments', 'warn', 'No unnecessary fragments.'),
  rule(
    'react',
    'react/self-closing-comp',
    'style/useSelfClosingElements',
    'warn',
    'Self-close elements without children.'
  ),
  rule(
    'react',
    '@eslint-react/dom-no-missing-button-type',
    'a11y/useButtonType',
    'warn',
    'Require an explicit, valid type on every \\<button>.'
  ),
  rule(
    'react',
    '@eslint-react/dom-no-unsafe-target-blank',
    'security/noBlankTarget',
    'warn',
    'Disallow target="_blank" attribute without rel="noopener".'
  ),
  rule(
    'react',
    'react-refresh/only-export-components',
    'style/useComponentExportOnlyModules',
    'warn',
    'Enforce declaring components only within modules that export React Components exclusively.'
  ),
  rule(
    'react',
    '@eslint-react/no-unstable-default-props',
    'nursery/noReactObjectTypeAsDefaultProp',
    'off',
    'No object or array literals as default props, which make a new value on every render.',
    { strict: 'warn', nursery: true }
  ),

  // Accessibility. The recommended rules of eslint-plugin-jsx-a11y, so Biome and Oxlint enforce
  // them without the plugin. anchor-is-valid has no Biome mapping here: Biome's useValidAnchor is
  // filed under qwik/jsx-a, and Biome's recommended set has it on anyway.
  rule('react', 'jsx-a11y/alt-text', 'a11y/useAltText', 'error', 'Give images and image-like elements alt text.'),
  rule('react', 'jsx-a11y/anchor-has-content', 'a11y/useAnchorContent', 'error', 'Give anchors content.'),
  rule('react', 'jsx-a11y/anchor-is-valid', undefined, 'error', 'Require anchors to have a valid href.'),
  rule(
    'react',
    'jsx-a11y/aria-activedescendant-has-tabindex',
    'a11y/useAriaActivedescendantWithTabindex',
    'error',
    'Make elements with aria-activedescendant tabbable.'
  ),
  rule('react', 'jsx-a11y/aria-props', 'a11y/useValidAriaProps', 'error', 'Use only valid aria-* attributes.'),
  rule('react', 'jsx-a11y/aria-proptypes', 'a11y/useValidAriaValues', 'error', 'Give aria-* attributes valid values.'),
  rule('react', 'jsx-a11y/aria-role', 'a11y/useValidAriaRole', 'error', 'Use only valid ARIA roles.'),
  rule(
    'react',
    'jsx-a11y/aria-unsupported-elements',
    'a11y/noAriaUnsupportedElements',
    'error',
    'No ARIA on elements that do not support it.'
  ),
  rule('react', 'jsx-a11y/autocomplete-valid', 'a11y/useValidAutocomplete', 'error', 'Use valid autocomplete values.'),
  rule(
    'react',
    'jsx-a11y/click-events-have-key-events',
    'a11y/useKeyWithClickEvents',
    'error',
    'Pair click handlers with a keyboard handler.'
  ),
  rule('react', 'jsx-a11y/heading-has-content', 'a11y/useHeadingContent', 'error', 'Give headings content.'),
  rule('react', 'jsx-a11y/html-has-lang', 'a11y/useHtmlLang', 'error', 'Give the html element a lang attribute.'),
  rule('react', 'jsx-a11y/iframe-has-title', 'a11y/useIframeTitle', 'error', 'Give iframes a title.'),
  rule('react', 'jsx-a11y/img-redundant-alt', 'a11y/noRedundantAlt', 'error', 'No "image" or "photo" in alt text.'),
  rule(
    'react',
    'jsx-a11y/interactive-supports-focus',
    'a11y/useFocusableInteractive',
    'error',
    'Make elements with interactive handlers focusable.',
    {
      options: {
        eslint: [{ tabbable: ['button', 'checkbox', 'link', 'searchbox', 'spinbutton', 'switch', 'textbox'] }]
      }
    }
  ),
  rule(
    'react',
    'jsx-a11y/label-has-associated-control',
    'a11y/noLabelWithoutControl',
    'error',
    'Tie every label to a control.'
  ),
  rule('react', 'jsx-a11y/media-has-caption', 'a11y/useMediaCaption', 'error', 'Give audio and video captions.'),
  rule(
    'react',
    'jsx-a11y/mouse-events-have-key-events',
    'a11y/useKeyWithMouseEvents',
    'error',
    'Pair mouse over and out with focus and blur.'
  ),
  rule('react', 'jsx-a11y/no-access-key', 'a11y/noAccessKey', 'error', 'No accessKey attributes.'),
  rule('react', 'jsx-a11y/no-autofocus', 'a11y/noAutofocus', 'error', 'No autoFocus.'),
  rule(
    'react',
    'jsx-a11y/no-distracting-elements',
    'a11y/noDistractingElements',
    'error',
    'No marquee or blink elements.'
  ),
  rule(
    'react',
    'jsx-a11y/no-interactive-element-to-noninteractive-role',
    'a11y/noInteractiveElementToNoninteractiveRole',
    'error',
    'No non-interactive roles on interactive elements.',
    { options: { eslint: [{ tr: ['none', 'presentation'], canvas: ['img'] }] } }
  ),
  rule(
    'react',
    'jsx-a11y/no-noninteractive-element-interactions',
    'a11y/noNoninteractiveElementInteractions',
    'error',
    'No event handlers on non-interactive elements.',
    {
      options: {
        eslint: [
          {
            handlers: [
              'onClick',
              'onError',
              'onLoad',
              'onMouseDown',
              'onMouseUp',
              'onKeyPress',
              'onKeyDown',
              'onKeyUp'
            ],
            alert: ['onKeyUp', 'onKeyDown', 'onKeyPress'],
            body: ['onError', 'onLoad'],
            dialog: ['onKeyUp', 'onKeyDown', 'onKeyPress'],
            iframe: ['onError', 'onLoad'],
            img: ['onError', 'onLoad']
          }
        ]
      }
    }
  ),
  rule(
    'react',
    'jsx-a11y/no-noninteractive-element-to-interactive-role',
    'a11y/noNoninteractiveElementToInteractiveRole',
    'error',
    'No interactive roles on non-interactive elements.',
    {
      options: {
        eslint: [
          {
            ul: ['listbox', 'menu', 'menubar', 'radiogroup', 'tablist', 'tree', 'treegrid'],
            ol: ['listbox', 'menu', 'menubar', 'radiogroup', 'tablist', 'tree', 'treegrid'],
            li: ['menuitem', 'menuitemradio', 'menuitemcheckbox', 'option', 'row', 'tab', 'treeitem'],
            table: ['grid'],
            td: ['gridcell'],
            fieldset: ['radiogroup', 'presentation']
          }
        ]
      }
    }
  ),
  rule(
    'react',
    'jsx-a11y/no-noninteractive-tabindex',
    'a11y/noNoninteractiveTabindex',
    'error',
    'No tabIndex on non-interactive elements.',
    { options: { eslint: [{ tags: [], roles: ['tabpanel'], allowExpressionValues: true }] } }
  ),
  rule('react', 'jsx-a11y/no-redundant-roles', 'a11y/noRedundantRoles', 'error', 'No roles an element already has.'),
  rule(
    'react',
    'jsx-a11y/no-static-element-interactions',
    'a11y/noStaticElementInteractions',
    'error',
    'No event handlers on static elements such as div.',
    {
      options: {
        eslint: [
          {
            allowExpressionValues: true,
            handlers: ['onClick', 'onMouseDown', 'onMouseUp', 'onKeyPress', 'onKeyDown', 'onKeyUp']
          }
        ]
      }
    }
  ),
  rule(
    'react',
    'jsx-a11y/role-has-required-aria-props',
    'a11y/useAriaPropsForRole',
    'error',
    'Give each role the ARIA attributes it requires.'
  ),
  rule(
    'react',
    'jsx-a11y/role-supports-aria-props',
    'a11y/useAriaPropsSupportedByRole',
    'error',
    'Use only ARIA attributes the role supports.'
  ),
  rule('react', 'jsx-a11y/scope', 'a11y/noHeaderScope', 'error', 'Use scope only on th elements.'),
  rule('react', 'jsx-a11y/tabindex-no-positive', 'a11y/noPositiveTabindex', 'error', 'No positive tabIndex values.'),

  // Qwik
  rule(
    'qwik',
    'qwik/jsx-a',
    'a11y/useValidAnchor',
    'warn',
    'Require anchors to provide a real navigation destination.'
  ),
  rule(
    'qwik',
    'qwik/jsx-img',
    'correctness/useImageSize',
    'warn',
    'Enforces that \\<img> elements have both width and height attributes.'
  ),
  rule('qwik', 'qwik/jsx-no-script-url', 'security/noScriptUrl', 'warn', 'Disallow javascript: URLs in HTML.'),
  rule(
    'qwik',
    'qwik/loader-location',
    'correctness/useQwikLoaderLocation',
    'warn',
    'Enforce that Qwik loader functions are declared in the correct location.'
  ),
  rule(
    'qwik',
    'qwik/no-react-props',
    'suspicious/noReactSpecificProps',
    'error',
    'Prevents React-specific JSX properties from being used.'
  ),
  rule(
    'qwik',
    'qwik/no-use-visible-task',
    'correctness/noQwikUseVisibleTask',
    'warn',
    'Disallow useVisibleTask$() functions in Qwik components.'
  ),
  rule(
    'qwik',
    'qwik/prefer-classlist',
    'correctness/useQwikClasslist',
    'warn',
    'Prefer using the class prop as a classlist over the classnames helper.'
  ),
  rule(
    'qwik',
    'qwik/use-method-usage',
    'correctness/useQwikMethodUsage',
    'error',
    'Disallow use* hooks outside of component$ or other use* hooks in Qwik applications.'
  ),
  rule(
    'qwik',
    'qwik/valid-lexical-scope',
    'correctness/useQwikValidLexicalScope',
    'error',
    'Disallow unserializable expressions in Qwik dollar ($) scopes.'
  ),

  // Vue
  rule(
    'vue',
    'vue/block-order',
    'nursery/useVueBlockOrder',
    'off',
    'Enforce the order of the top-level blocks in Vue components.',
    { strict: 'warn', nursery: true }
  ),
  rule(
    'vue',
    'vue/multi-word-component-names',
    'style/useVueMultiWordComponentNames',
    'warn',
    'Enforce multi-word component names in Vue components.'
  ),
  rule(
    'vue',
    'vue/no-mutating-props',
    'nursery/noVueMutatingProps',
    'off',
    'Disallow changing the props of a Vue component.',
    { strict: 'warn', nursery: true }
  ),
  rule(
    'vue',
    'vue/require-default-prop',
    'nursery/useVueDefaultProp',
    'off',
    'Require a default value for optional props in Vue components.',
    { strict: 'warn', nursery: true }
  ),
  rule(
    'vue',
    'vue/require-prop-types',
    'nursery/useVueTypedProps',
    'off',
    'Require a type for every prop of a Vue component.',
    { strict: 'warn', nursery: true }
  ),
  rule(
    'vue',
    'vue/component-definition-name-casing',
    undefined,
    'warn',
    'Write the name of a component definition in PascalCase.'
  ),

  // Svelte
  rule(
    'svelte',
    'svelte/no-at-html-tags',
    'nursery/noSvelteAtHtmlTags',
    'off',
    "Disallow the use of Svelte's {@html} tag.",
    { strict: 'warn', nursery: true }
  ),
  rule(
    'svelte',
    'svelte/require-each-key',
    'nursery/useSvelteRequireEachKey',
    'off',
    'Require keyed {#each} blocks in Svelte templates.',
    { strict: 'warn', nursery: true }
  ),

  // Imports and dependencies
  rule('imports', 'unused-imports/no-unused-imports', 'correctness/noUnusedImports', 'warn', 'No unused imports.', {
    strict: 'error',
    advice: 'Remove the import.'
  }),
  rule(
    'imports',
    'import/no-extraneous-dependencies',
    'correctness/noUndeclaredDependencies',
    'error',
    'No importing a package that package.json does not declare.',
    {
      guardrail: true,
      aliases: ['n/no-extraneous-import'],
      advice: 'Check that the package exists and is the one you mean, then add it to package.json.'
    }
  ),
  rule('imports', 'import/no-unresolved', 'correctness/noUnresolvedImports', 'off', 'No imports that do not resolve.', {
    strict: 'error',
    guardrail: true,
    aliases: ['n/no-missing-import'],
    advice: 'Fix the path or the export name. Do not invent modules.'
  }),
  rule('imports', 'import/no-cycle', 'suspicious/noImportCycles', 'off', 'No import cycles.', { strict: 'error' }),
  rule(
    'imports',
    'import/first',
    'style/useImportsFirst',
    'error',
    'Enforce that all imports appear at the top of the module.'
  ),
  rule('imports', 'import/no-self-import', 'nursery/noSelfImport', 'off', 'Forbid a module from importing itself.', {
    strict: 'error',
    nursery: true
  }),
  // No Biome rule. Biome's import sorting merges duplicate imports; Oxlint enforces both.
  rule('imports', 'import/no-duplicates', undefined, 'warn', 'Import from a module in one statement, not several.'),
  rule('imports', 'import/export', undefined, 'off', 'No exporting the same name twice.', {
    strict: 'warn',
    nursery: true
  }),

  // Tests
  rule('tests', 'no-only-tests/no-only-tests', 'suspicious/noFocusedTests', 'error', 'No focused tests (.only).', {
    guardrail: true,
    aliases: ['vitest/no-focused-tests'],
    advice: 'Remove .only so the whole suite runs.'
  }),
  rule('tests', 'vitest/no-disabled-tests', 'suspicious/noSkippedTests', 'warn', 'No skipped tests.', {
    strict: 'error',
    guardrail: true,
    advice: 'Fix the test and remove .skip. Do not skip a test to make a run pass.'
  }),
  rule('tests', 'vitest/no-duplicate-hooks', 'suspicious/noDuplicateTestHooks', 'error', 'No duplicate test hooks.'),
  rule(
    'tests',
    'vitest/consistent-test-it',
    'style/useConsistentTestIt',
    'warn',
    'Enforce consistent use of it or test for test functions.',
    { options: { biome: { function: 'test', withinDescribe: 'it' }, eslint: [{ fn: 'test' }] } }
  ),
  rule(
    'tests',
    'vitest/expect-expect',
    'suspicious/useExpect',
    'error',
    'Ensure that test functions contain at least one expect() or similar assertion.'
  ),
  rule(
    'tests',
    'vitest/max-nested-describe',
    'complexity/noExcessiveNestedTestSuites',
    'error',
    'This rule enforces a maximum depth to nested describe() in test files.'
  ),
  rule(
    'tests',
    'vitest/no-identical-title',
    'suspicious/noIdenticalTestTitle',
    'error',
    'Disallow identical titles in test suites and test cases.'
  ),
  // No Biome equivalent: Oxlint enforces these, or ESLint with @vitest/eslint-plugin.
  rule('tests', 'vitest/prefer-to-be', undefined, 'warn', 'Use toBe() to compare primitive values.'),
  rule('tests', 'vitest/prefer-to-have-length', undefined, 'warn', 'Use toHaveLength() to check a length.'),
  rule('tests', 'vitest/valid-expect', undefined, 'error', 'Call expect() with one value and a matcher.'),

  // Markdown and YAML files
  rule(
    'formats',
    'markdown/fenced-code-language',
    'nursery/useFencedCodeLanguage',
    'off',
    'Name the language of every fenced code block.',
    { strict: 'error', nursery: true }
  ),
  rule(
    'formats',
    'markdown/heading-increment',
    'nursery/useConsistentHeadingLevel',
    'off',
    'Raise heading levels one at a time.',
    { strict: 'error', nursery: true }
  ),
  rule(
    'formats',
    'yml/no-empty-sequence-entry',
    'nursery/noYamlEmptySequenceEntries',
    'off',
    'No empty entries in a YAML list.',
    { strict: 'error', nursery: true }
  ),

  // Turborepo
  rule(
    'turbo',
    'turbo/no-undeclared-env-vars',
    'suspicious/noUndeclaredEnvVars',
    'error',
    'Disallow the use of undeclared environment variables.'
  ),

  // Pawl's own checks. These run in pawl itself, on top of the engines.
  rule('pawl', 'pawl/format', undefined, 'error', 'The file is not formatted to the standard.', {
    advice: 'Run "pawl fix".'
  }),
  rule('pawl', 'pawl/organize-imports', undefined, 'error', 'Imports are not sorted.', { advice: 'Run "pawl fix".' }),
  rule('pawl', 'pawl/no-new-disable', undefined, 'error', 'No new comments that switch a check off.', {
    guardrail: true,
    advice: 'Remove the disable comment and fix the finding it hides.'
  }),
  rule('pawl', 'pawl/no-weaker-tests', undefined, 'error', 'No test file losing assertions or gaining skipped tests.', {
    guardrail: true,
    advice: 'Put back the assertions with the values they pinned, or make the skipped test pass.'
  }),
  rule(
    'pawl',
    'pawl/no-baseline-growth',
    undefined,
    'error',
    'No baseline that allows more than the one on the base branch, with --since, unless a person accepted it.',
    {
      guardrail: true,
      advice:
        'Fix the findings instead of recording them. A person who accepts them adds "Pawl-Baseline: accept" to a commit message on the branch.'
    }
  )
]

const BY_NAME = new Map(RULES.flatMap(def => [def.name, ...(def.aliases ?? [])].map(name => [name, def] as const)))

const BY_BIOME = new Map(RULES.flatMap(def => (def.biome ? [[def.biome, def] as const] : [])))

/** Look a rule up by its neutral name or one of its aliases. */
export const getRule = (name: string): RuleDef | undefined => BY_NAME.get(name)

export const getRuleByBiome = (biomeRule: string): RuleDef | undefined => BY_BIOME.get(biomeRule)

/** The engines a policy can name a rule for directly, outside the catalog. */
export type ScopedEngine = 'biome' | 'oxlint' | 'eslint'

const SCOPED: readonly ScopedEngine[] = ['biome', 'oxlint', 'eslint']

/**
 * The name a policy and a finding use for a rule only one engine has, such as
 * `biome:style/useBlockStatements` or `oxlint:unicorn/no-null`.
 */
export const scopedName = (engine: ScopedEngine, rule: string): string => `${engine}:${rule}`

/** The engine's own rule a scoped name stands for, or undefined when the name is not for that engine. */
export const scopedRule = (name: string, engine: ScopedEngine): string | undefined =>
  name.startsWith(`${engine}:`) ? name.slice(engine.length + 1) : undefined

/**
 * The tools of the other languages, each of which names its rules itself: `clippy:needless_return`,
 * `swiftlint:force_cast`.
 */
export const LANGUAGE_ENGINES: readonly LanguageEngine[] = [
  'clippy',
  'rustc',
  'rustfmt',
  'swiftlint',
  'swiftformat',
  'swift-format',
  'ktlint'
]

/** True for a rule of another language's tool, which ESLint, Oxlint and Biome never see. */
export const isLanguageRule = (name: string): boolean => LANGUAGE_ENGINES.some(engine => name.startsWith(`${engine}:`))

/**
 * True for a name another engine runs, one of pawl's own rules, or a rule of another language's
 * tool, which `engine` must leave alone.
 */
export const notFor = (name: string, engine: ScopedEngine): boolean =>
  name.startsWith('pawl/') ||
  isLanguageRule(name) ||
  SCOPED.some(other => other !== engine && scopedRule(name, other) !== undefined)

/** The name the catalog files a rule under. Names it does not know are returned as they are. */
export const canonicalName = (name: string): string => BY_NAME.get(name)?.name ?? name

/** The level a catalog rule has before any override. Unknown rules are off. */
export const defaultLevel = (name: string, strict: boolean): Level => {
  const def = BY_NAME.get(name)

  if (!def) return 'off'

  return strict ? (def.strict ?? def.level) : def.level
}

/** Find a rule by its neutral name, an alias, its Biome name, or the last part of any of them. */
export const findRule = (query: string): RuleDef | undefined => {
  const exact = BY_NAME.get(query) ?? BY_BIOME.get(query)

  if (exact) return exact

  const wanted = query.toLowerCase()

  return RULES.find(def => {
    const names = [def.name, def.biome ?? '', ...(def.aliases ?? [])].map(value => value.toLowerCase())

    return names.some(value => value === wanted || value.endsWith(`/${wanted}`))
  })
}
