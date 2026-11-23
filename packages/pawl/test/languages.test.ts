import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isLanguageRule } from '../src/catalog/rules.ts'
import { check } from '../src/check/check.ts'
import { exitCode } from '../src/check/result.ts'
import { biomeConfig, biomeProjectConfig } from '../src/engines/biome/config.ts'
import { runBiome } from '../src/engines/biome/run.ts'
import { biomeContextFor } from '../src/engines/biome/state.ts'
import { findOnPath } from '../src/engines/engine.ts'
import { eslintPlanFor } from '../src/engines/eslint/plan.ts'
import { parseClippy, parseRustfmt } from '../src/engines/languages/cargo.ts'
import { checkLanguages } from '../src/engines/languages/check.ts'
import { parseKtlint, runKtlint } from '../src/engines/languages/ktlint.ts'
import { parseSwiftFormat, parseSwiftLint, runSwiftFormat, runSwiftLint } from '../src/engines/languages/swift.ts'
import { oxlintConfig, oxlintContextFor } from '../src/engines/oxlint/config.ts'
import { defaultPolicy, mergeLayers } from '../src/policy/merge.ts'
import { describe as describeRepo, detect } from '../src/project/detect.ts'
import { ignoreMatcher } from '../src/project/ignores.ts'
import { toolset } from '../src/project/toolset.ts'
import { doctor, formatDoctor } from '../src/report/doctor.ts'
import { explainRule } from '../src/report/explain.ts'
import { planInit } from '../src/setup/init.ts'
import { link, project, write } from './helpers.ts'

const polyglot = (): string =>
  project({
    'package.json': { name: 'repo', private: true, workspaces: ['apps/*'] },
    'apps/web/package.json': { name: 'web', dependencies: { react: '^19.0.0' } },
    'Cargo.toml': '[workspace]\nmembers = ["crates/*"]\n',
    'crates/core/Cargo.toml': '[package]\nname = "core"\n',
    'crates/core/src/lib.rs': 'pub fn one() -> i32 { 1 }\n',
    'apps/ios/App.xcodeproj/project.pbxproj': '',
    'apps/ios/App/Assets.xcassets/Contents.json': '{"info":{"version":1,"author":"xcode"}}',
    'apps/ios/Packages/Kit/Package.swift': '// swift-tools-version: 6.0\n',
    'apps/ios/Package.resolved': '{"pins":[]}',
    'apps/android/settings.gradle.kts': 'include(":app")\n',
    'apps/android/app/build.gradle.kts': 'plugins { id("org.jetbrains.kotlin.android") }\n'
  })

describe('other languages: detection', () => {
  it('finds Rust, Swift and Kotlin projects next to the JavaScript ones, and names them', () => {
    const detection = detect(polyglot())

    expect(detection.languages).toEqual([
      { dir: '', language: 'rust', manifest: 'Cargo.toml' },
      { dir: 'apps/android', language: 'kotlin', manifest: 'settings.gradle.kts' },
      { dir: 'apps/ios', language: 'swift', manifest: 'App.xcodeproj' }
    ])
    // Cargo's build folder sits next to the workspace, so it is skipped there and nowhere else.
    expect(detection.ignores).toEqual(['target/**'])
    expect(describeRepo(detection)).toBe('JavaScript, React, Rust, Swift, Kotlin, workspace with 1 package, npm')
  })

  it('keeps a crate outside a workspace as a project of its own, and leaves Java builds alone', () => {
    const root = project({
      'crates/a/Cargo.toml': '[package]\nname = "a"\n',
      'crates/a/inner/Cargo.toml': '[package]\nname = "inner"\n',
      'tools/java/pom.xml': '<project><artifactId>tool</artifactId></project>',
      'tools/kotlin/pom.xml': '<project><plugin>kotlin-maven-plugin</plugin></project>',
      'service/build.gradle': "apply plugin: 'java'\n"
    })
    const detection = detect(root)

    expect(detection.languages).toEqual([
      { dir: 'crates/a', language: 'rust', manifest: 'Cargo.toml' },
      { dir: 'crates/a/inner', language: 'rust', manifest: 'Cargo.toml' },
      { dir: 'tools/kotlin', language: 'kotlin', manifest: 'pom.xml' }
    ])
    expect(detection.ignores).toEqual(['crates/a/target/**', 'crates/a/inner/target/**', 'tools/kotlin/target/**'])
    // No package.json anywhere: there is no JavaScript to name.
    expect(describeRepo(detection)).toBe('Rust, Kotlin')
  })

  it('skips what the repo ignores, such as a generated ios folder, and what the policy leaves out', () => {
    const root = project({
      '.gitignore': '/ios\n',
      'package.json': { dependencies: { expo: '^54.0.0' } },
      'ios/App.xcodeproj/project.pbxproj': '',
      'android/settings.gradle.kts': '',
      'rust/Cargo.toml': '[package]\nname = "native"\n'
    })

    expect(detect(root).languages.map(project => project.language)).toEqual(['kotlin', 'rust'])

    const policy = mergeLayers([{ source: 'repo', input: { detect: { exclude: ['kotlin'] } } }])

    expect(detect(root, policy).languages.map(project => project.language)).toEqual(['rust'])
    expect(detect(root, mergeLayers([{ source: 'repo', input: { detect: false } }])).languages).toEqual([])
  })

  it('has init say what it found and how to check it, until the policy names it', async () => {
    const root = polyglot()
    const note = (plan: { notes: string[] }): string | undefined => plan.notes.find(line => line.startsWith('Found'))

    expect(note(await planInit({ root, install: false, editor: false }))).toBe(
      "Found Rust in the root, Swift in apps/ios and Kotlin in apps/android. Pawl leaves them to their own tools. To check them with pawl and the baseline, add languages: ['rust', 'swift', 'kotlin'] to the policy."
    )

    writeFileSync(join(root, 'pawl.config.json'), JSON.stringify({ languages: ['rust', 'kotlin'] }))

    expect(note(await planInit({ root, install: false, editor: false }))).toBe(
      "Found Swift in apps/ios. Pawl leaves it to its own tools. To check it with pawl and the baseline, add languages: ['swift'] to the policy."
    )
  })

  it('does not walk into Cargo build folders or Xcode bundles looking for more', () => {
    const root = project({
      'Cargo.toml': '[package]\nname = "app"\n',
      'target/debug/build/dep/out/package/settings.gradle.kts': '',
      'ios/App.xcodeproj/inner/Cargo.toml': '[package]\nname = "generated"\n'
    })

    expect(detect(root).languages).toEqual([
      { dir: '', language: 'rust', manifest: 'Cargo.toml' },
      { dir: 'ios', language: 'swift', manifest: 'App.xcodeproj' }
    ])
  })
})

describe('other languages: ignores', () => {
  it('keeps the JavaScript engines out of the files the other tools write', async () => {
    const root = polyglot()
    const policy = defaultPolicy()
    const detection = detect(root, policy)
    const ignored = ignoreMatcher(root, policy, detection.ignores)

    for (const file of [
      'target/debug/deps/doc/search-index.js',
      'apps/ios/App/Assets.xcassets/Contents.json',
      'apps/ios/Package.resolved',
      'Cargo.lock',
      'apps/ios/Pods/Lib/info.json',
      'apps/android/.gradle/state.json',
      'apps/ios/.build/checkouts/kit/package.json'
    ]) {
      expect(ignored(file), file).toBe(true)
    }

    // `target` is anchored to the Rust project: a folder of that name elsewhere is still checked.
    expect(ignored('apps/web/src/target/index.ts')).toBe(false)

    const biome = biomeConfig(policy, biomeContextFor(root, policy, detection, toolset(root, policy))) as {
      files: { includes: string[] }
    }

    expect(biome.files.includes).toEqual(expect.arrayContaining(['!target', '!**/*.xcassets', '!**/Package.resolved']))
    // The project's biome.json adds the detected folder to the preset's list, which has the rest.
    expect(biomeProjectConfig(policy, biomeContextFor(root, policy, detection, toolset(root, policy))).files).toEqual({
      includes: ['!target']
    })
    expect(oxlintConfig(policy, oxlintContextFor(detection)).ignorePatterns).toContain('target/**')

    const ignores = (await eslintPlanFor(root, policy)).config[0]?.ignores

    expect(ignores).toEqual(expect.arrayContaining(['target/**', '**/*.xcassets/**']))
  })
})

describe('other languages: ignores, with the real Biome', () => {
  it('skips the target folder of the Rust project and keeps one of that name elsewhere', async () => {
    const root = project({
      'package.json': { name: 'repo', private: true },
      'Cargo.toml': '[package]\nname = "app"\n',
      'target/doc/static.files/search.json': '{"a":1,   "b":2}\n',
      'web/target/data.json': '{"a":1,   "b":2}\n',
      'ios/App/Assets.xcassets/Contents.json': '{"info":{"author":"xcode",   "version":1}}\n'
    })
    const policy = defaultPolicy()
    const detection = detect(root, policy)

    link(root)
    write(root, {
      'biome.json': biomeProjectConfig(policy, biomeContextFor(root, policy, detection, toolset(root, policy)))
    })

    const { findings } = await runBiome({ root })

    const files = new Set(findings.map(finding => finding.file).filter(file => file !== 'biome.json'))

    expect([...files]).toEqual(['web/target/data.json'])
  })
})

describe('other languages: the policy', () => {
  it('switches languages on by name, picks their tools, and lets a later layer switch one off', () => {
    const policy = mergeLayers([
      { source: 'company', input: { languages: { swift: { format: false } } } },
      { source: 'repo', input: { languages: ['rust', 'swift'] } },
      { source: 'team', input: { languages: { kotlin: true, rust: false } } }
    ])

    expect(policy.languages).toEqual({
      swift: { lint: true, format: false },
      kotlin: { lint: true, format: true }
    })
    expect(defaultPolicy().languages).toEqual({})
  })

  it('keeps the rules of those tools away from ESLint', () => {
    expect(isLanguageRule('clippy:unwrap_used')).toBe(true)
    expect(isLanguageRule('swiftlint:force_cast')).toBe(true)
    expect(isLanguageRule('ktlint:standard:no-wildcard-imports')).toBe(true)
    expect(isLanguageRule('no-console')).toBe(false)
  })

  it("explains a rule of one of those tools as that tool's own", () => {
    expect(explainRule(defaultPolicy(), 'clippy:needless_return')).toEqual(
      expect.arrayContaining(['clippy:needless_return', '  Checked by:  Clippy'])
    )
    expect(explainRule(defaultPolicy(), 'ktlint:standard:no-wildcard-imports')?.[1]).toContain(
      "under ktlint's own name, standard:no-wildcard-imports"
    )
  })
})

describe('other languages: reports', () => {
  const root = '/repo'

  it('reads Clippy, once per place, with the compiler warnings and errors next to its own', () => {
    const lint = (code: string, file: string, level = 'warning', fix = 'MachineApplicable'): string =>
      JSON.stringify({
        reason: 'compiler-message',
        message: {
          message: `about ${code}`,
          level,
          code: { code },
          spans: [{ file_name: file, line_start: 3, column_start: 5, is_primary: true }],
          children: [
            {
              message: 'fix',
              level: 'help',
              spans: [
                { file_name: file, line_start: 3, column_start: 5, is_primary: true, suggestion_applicability: fix }
              ]
            }
          ]
        }
      })
    const stdout = [
      lint('clippy::needless_return', 'src/lib.rs'),
      lint('clippy::needless_return', 'src/lib.rs'),
      lint('unused_variables', 'src/lib.rs', 'warning', 'MaybeIncorrect'),
      lint('E0308', 'src/main.rs', 'error'),
      lint('clippy::all', '/home/me/.cargo/registry/src/dep/lib.rs'),
      JSON.stringify({
        reason: 'compiler-message',
        message: { message: '2 warnings emitted', level: 'warning', spans: [] }
      }),
      JSON.stringify({ reason: 'build-finished', success: false })
    ].join('\n')
    const { findings, failed } = parseClippy(root, '/repo/crates/core', stdout)

    expect(failed).toBe(true)
    expect(findings).toEqual([
      expect.objectContaining({
        file: 'crates/core/src/lib.rs',
        line: 3,
        column: 5,
        engine: 'clippy',
        engineRule: 'needless_return',
        rule: 'clippy:needless_return',
        severity: 'warn',
        fixable: true
      }),
      expect.objectContaining({ engine: 'rustc', rule: 'rustc:unused_variables', fixable: false }),
      expect.objectContaining({ file: 'crates/core/src/main.rs', rule: 'rustc:E0308', severity: 'error' })
    ])
  })

  it('reads rustfmt, at the first line each change touches', () => {
    const stdout = [
      'Diff in /repo/src/lib.rs:1:',
      ' pub fn add(a: i32, b: i32) -> i32 {',
      '     let unused = 3;',
      '-    return a+b;',
      '+    return a + b;',
      ' }',
      'Diff in /repo/src/main.rs at line 7:',
      '-fn main(){}',
      '+fn main() {}'
    ].join('\n')

    expect(parseRustfmt(root, root, stdout)).toEqual([
      expect.objectContaining({
        file: 'src/lib.rs',
        line: 3,
        engine: 'rustfmt',
        rule: 'pawl/format',
        severity: 'error'
      }),
      expect.objectContaining({ file: 'src/main.rs', line: 7 })
    ])
  })

  it('reads SwiftLint, swift-format and ktlint', () => {
    const swiftlint = JSON.stringify([
      {
        character: null,
        file: '/repo/apps/ios/App/View.swift',
        line: 4,
        reason: 'Force casts should be avoided',
        rule_id: 'force_cast',
        severity: 'Error',
        type: 'Force Cast'
      },
      {
        character: 9,
        file: '/repo/apps/ios/App/View.swift',
        line: 7,
        reason: 'Line too long',
        rule_id: 'line_length',
        severity: 'Warning'
      }
    ])

    expect(parseSwiftLint(root, '/repo/apps/ios', swiftlint)).toEqual([
      expect.objectContaining({
        file: 'apps/ios/App/View.swift',
        line: 4,
        column: 1,
        rule: 'swiftlint:force_cast',
        severity: 'error'
      }),
      expect.objectContaining({ line: 7, column: 9, rule: 'swiftlint:line_length', severity: 'warn' })
    ])

    const swiftFormat = 'App/View.swift:2:1: error: [Indentation] replace leading whitespace with 4 spaces\nnoise\n'
    const swiftFormatter =
      '/repo/apps/ios/App/View.swift:5:1: warning: (indent) Indent code in accordance with the scope level.\n'

    expect(parseSwiftFormat(root, '/repo/apps/ios', swiftFormatter, 'swiftformat')).toEqual([
      expect.objectContaining({
        file: 'apps/ios/App/View.swift',
        line: 5,
        engine: 'swiftformat',
        rule: 'swiftformat:indent',
        severity: 'error',
        message: 'Indent code in accordance with the scope level.'
      })
    ])

    expect(parseSwiftFormat(root, '/repo/apps/ios', swiftFormat)).toEqual([
      expect.objectContaining({
        file: 'apps/ios/App/View.swift',
        line: 2,
        engine: 'swift-format',
        rule: 'swift-format:Indentation',
        severity: 'error',
        message: 'replace leading whitespace with 4 spaces'
      })
    ])

    const ktlint = JSON.stringify([
      {
        file: 'app/src/main/kotlin/Main.kt',
        errors: [{ line: 1, column: 1, message: 'Wildcard import', rule: 'standard:no-wildcard-imports' }]
      }
    ])

    expect(parseKtlint(root, '/repo/apps/android', ktlint)).toEqual([
      expect.objectContaining({
        file: 'apps/android/app/src/main/kotlin/Main.kt',
        engine: 'ktlint',
        rule: 'ktlint:standard:no-wildcard-imports',
        severity: 'error'
      })
    ])
  })
})

/** A PATH with nothing on it, to see what pawl says when a tool is missing. */
const withoutTools = async <T>(run: () => Promise<T>): Promise<T> => {
  const saved = process.env.PATH

  process.env.PATH = ''

  try {
    return await run()
  } finally {
    process.env.PATH = saved
  }
}

describe('other languages: setup', () => {
  it('reports a missing tool as a setup problem that fails the check, and names how to install it', async () => {
    const root = project({
      'pawl.config.json': { engine: 'biome', defaultIgnores: true, languages: ['rust'] },
      'Cargo.toml': '[package]\nname = "app"\nversion = "0.1.0"\nedition = "2021"\n',
      'src/main.rs': 'fn main() {}\n'
    })
    const policy = mergeLayers([{ source: 'repo', input: { languages: ['rust'] } }])
    const result = await withoutTools(() =>
      checkLanguages({ root, policy, detection: detect(root, policy), ignored: () => false })
    )

    expect(result.setup).toEqual([
      {
        code: 'language-tool-missing',
        message: 'Rust is in the policy, but cargo is not installed.',
        fix: expect.stringContaining('rustup component add clippy rustfmt')
      }
    ])
    expect(
      exitCode({
        findings: [],
        baselined: 0,
        setup: result.setup,
        engines: [],
        commands: [],
        hasBaseline: false,
        canShrinkBaseline: false,
        nothingToCheck: false
      })
    ).toBe(2)
  })

  it('keeps the baseline as it was when a tool did not run, rather than forget what it allowed', async () => {
    const root = project({
      'pawl.config.json': { languages: ['rust'] },
      'Cargo.toml': '[package]\nname = "app"\n',
      'src/main.rs': 'fn main() {}\n',
      '.pawl/baseline.json': { version: 1, findings: { 'src/main.rs': { 'clippy:unwrap_used': 2 } }, suppressions: {} }
    })
    const before = readFileSync(join(root, '.pawl/baseline.json'), 'utf8')
    const result = await withoutTools(() => check({ root, updateBaseline: true }))

    expect(result.setup.map(issue => issue.code)).toContain('language-tool-missing')
    expect(readFileSync(join(root, '.pawl/baseline.json'), 'utf8')).toBe(before)
  })

  it('shows in doctor which languages pawl checks, with what, and what is missing', async () => {
    const root = polyglot()

    writeFileSync(
      join(root, 'pawl.config.json'),
      JSON.stringify({ languages: { rust: true, swift: { format: false } } })
    )

    const report = await withoutTools(() => doctor(root))

    expect(report.languages).toEqual([
      {
        language: 'rust',
        dir: '',
        manifest: 'Cargo.toml',
        checked: true,
        tools: [
          { name: 'Clippy', installed: false },
          { name: 'rustfmt', installed: false }
        ]
      },
      { language: 'kotlin', dir: 'apps/android', manifest: 'settings.gradle.kts', checked: false, tools: [] },
      {
        language: 'swift',
        dir: 'apps/ios',
        manifest: 'App.xcodeproj',
        checked: true,
        tools: [{ name: 'SwiftLint', installed: false }]
      }
    ])
    expect(report.problems).toContain(
      'Rust is in the policy, but Clippy and rustfmt are not installed. Install Rust with rustup, then run "rustup component add clippy rustfmt".'
    )

    const text = formatDoctor(report)

    expect(text).toContain(
      'Rust:     the root (Cargo.toml), checked with Clippy and rustfmt (Clippy and rustfmt not installed)'
    )
    expect(text).toContain('Kotlin:   apps/android (settings.gradle.kts), not checked (add "kotlin" to languages')
    expect(existsSync(join(root, '.pawl'))).toBe(false)
  })

  it('leaves a language the policy does not name alone', async () => {
    const root = project({ 'Cargo.toml': '[package]\nname = "app"\n', 'src/main.rs': 'fn main() {}\n' })
    const policy = defaultPolicy()
    const result = await withoutTools(() =>
      checkLanguages({ root, policy, detection: detect(root, policy), ignored: () => false })
    )

    expect(result).toEqual({ findings: [], commands: [], setup: [], engines: [] })
  })
})

const cargoProject = (): string =>
  project({
    'Cargo.toml': '[package]\nname = "app"\nversion = "0.1.0"\nedition = "2021"\n',
    'src/lib.rs': 'pub fn add(a: i32, b: i32) -> i32 {\n    let unused = 3;\n    return a+b;\n}\n'
  })

describe('other languages: the real Clippy and rustfmt', () => {
  it.skipIf(!findOnPath('cargo'))(
    'lints and checks the formatting of a Rust project, and applies the policy levels',
    async () => {
      const root = cargoProject()
      const policy = mergeLayers([
        { source: 'repo', input: { languages: ['rust'], rules: { 'rustc:unused_variables': 'error' } } }
      ])
      const result = await checkLanguages({ root, policy, detection: detect(root, policy), ignored: () => false })

      expect(result.setup).toEqual([])
      expect(result.engines).toEqual(['clippy', 'rustfmt'])
      expect(result.commands).toEqual(['cargo clippy --workspace --all-targets', 'cargo fmt --all --check'])
      expect(result.findings).toEqual([
        expect.objectContaining({ file: 'src/lib.rs', line: 2, rule: 'rustc:unused_variables', severity: 'error' }),
        expect.objectContaining({
          file: 'src/lib.rs',
          line: 3,
          rule: 'clippy:needless_return',
          severity: 'warn',
          fixable: true
        }),
        expect.objectContaining({ file: 'src/lib.rs', line: 3, rule: 'pawl/format', engine: 'rustfmt' })
      ])

      const off = mergeLayers([
        {
          source: 'repo',
          input: { languages: { rust: { format: false } }, rules: { 'clippy:needless_return': 'off' } }
        }
      ])
      const quieter = await checkLanguages({ root, policy: off, detection: detect(root, off), ignored: () => false })

      expect(quieter.findings.map(finding => finding.rule)).toEqual(['rustc:unused_variables'])
    },
    120_000
  )

  it.skipIf(!findOnPath('cargo'))(
    'fixes what Clippy and the compiler are sure of and formats, then reports what is left',
    async () => {
      const root = project({
        'Cargo.toml': '[package]\nname = "app"\nversion = "0.1.0"\nedition = "2021"\n',
        'src/lib.rs':
          'pub fn add(a: i32, b: i32) -> i32 {\n    let unused = 3;\n    return a+b;\n}\n\npub fn first(v: &Vec<i32>) -> i32 { v[0] }\n'
      })
      const policy = mergeLayers([{ source: 'repo', input: { languages: ['rust'] } }])
      const result = await checkLanguages({
        root,
        policy,
        detection: detect(root, policy),
        ignored: () => false,
        write: true
      })

      expect(result.setup).toEqual([])
      expect(readFileSync(join(root, 'src/lib.rs'), 'utf8')).toBe(
        'pub fn add(a: i32, b: i32) -> i32 {\n    let _unused = 3;\n    a + b\n}\n\npub fn first(v: &Vec<i32>) -> i32 {\n    v[0]\n}\n'
      )
      // Changing a public signature is not a fix Clippy is sure of, so it is left to report.
      expect(result.findings.map(finding => finding.rule)).toEqual(['clippy:ptr_arg'])
    },
    120_000
  )

  it.skipIf(!findOnPath('cargo'))(
    'runs only the crate a change is in, when one crate sits inside another',
    async () => {
      const crate = (name: string): string => `[package]\nname = "${name}"\nversion = "0.1.0"\nedition = "2021"\n`
      const root = project({
        'Cargo.toml': crate('app'),
        'src/lib.rs': 'pub fn one() -> i32 {\n    return 1;\n}\n',
        'tools/gen/Cargo.toml': crate('gen'),
        'tools/gen/src/lib.rs': 'pub fn two() -> i32 {\n    return 2;\n}\n'
      })
      const policy = mergeLayers([{ source: 'repo', input: { languages: { rust: { format: false } } } }])
      const result = await checkLanguages({
        root,
        policy,
        detection: detect(root, policy),
        ignored: () => false,
        files: ['tools/gen/src/lib.rs']
      })

      expect(result.commands).toEqual(['(cd tools/gen && cargo clippy --workspace --all-targets)'])
      expect(result.findings.map(finding => `${finding.file} ${finding.rule}`)).toEqual([
        'tools/gen/src/lib.rs clippy:needless_return'
      ])
    },
    120_000
  )

  it.skipIf(!findOnPath('cargo'))(
    'runs inside a full check, honours --changed scoping, and reaches the baseline like any engine',
    async () => {
      const root = cargoProject()
      const policy = mergeLayers([{ source: 'repo', input: { engine: 'biome', languages: ['rust'] } }])
      const untouched = await check({ root, policy, files: ['README.md'] })

      expect(untouched.engines).not.toContain('clippy')

      const result = await check({ root, policy, files: ['src/lib.rs'] })

      expect(result.engines).toEqual(expect.arrayContaining(['clippy', 'rustfmt']))
      expect(result.findings.map(finding => finding.rule)).toEqual(
        expect.arrayContaining(['clippy:needless_return', 'pawl/format'])
      )
    },
    120_000
  )

  it.skipIf(!findOnPath('cargo'))(
    'is a setup problem when Cargo stops before it builds, and prints no report to say so',
    async () => {
      const root = project({
        'Cargo.toml':
          '[package]\nname = "app"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\nnope = { path = "./missing" }\n',
        'src/lib.rs': 'pub fn one() -> u8 {\n    1\n}\n'
      })
      const policy = mergeLayers([{ source: 'repo', input: { engine: 'biome', languages: ['rust'] } }])
      const result = await check({ root, policy, files: ['src/lib.rs'] })

      expect(result.setup.map(issue => issue.code)).toContain('engine-failed')
    },
    120_000
  )
})

const swiftProject = (): string =>
  project({
    'Package.swift': '// swift-tools-version: 5.9\nimport PackageDescription\nlet package = Package(name: "App")\n',
    'Sources/App/main.swift': 'let value = ["a": 1] as! [String: Int]\nprint( value )\n'
  })

describe('other languages: the real SwiftLint', () => {
  it.skipIf(!findOnPath('swiftlint'))(
    'lints a Swift package',
    async () => {
      const root = swiftProject()
      const result = await runSwiftLint({ root, dir: '', files: ['Sources/App/main.swift'] })

      expect(result.findings.map(finding => finding.rule)).toContain('swiftlint:force_cast')
    },
    120_000
  )
})

describe('other languages: the real Swift formatters', () => {
  it.skipIf(!findOnPath('swiftformat') && !findOnPath('swift-format') && !findOnPath('swift'))(
    'reports what the installed formatter would change',
    async () => {
      const root = swiftProject()
      const result = await runSwiftFormat({ root, dir: '', files: ['Sources/App/main.swift'] })

      expect(result.findings.length).toBeGreaterThan(0)
      expect(result.findings.every(finding => finding.engine === result.engine)).toBe(true)
    },
    120_000
  )

  it('picks the formatter whose config the project has, and says when none is installed', async () => {
    const root = project({ '.swift-format': '{}', 'Sources/App/main.swift': 'print(1)\n' })
    const error = await withoutTools(() => runSwiftFormat({ root, dir: '', files: ['Sources/App/main.swift'] })).catch(
      (caught: unknown) => caught
    )

    expect(String(error)).toContain('the project uses swift-format, but swift-format is not installed')
  })
})

describe('other languages: the real ktlint', () => {
  it.skipIf(!findOnPath('ktlint'))(
    'lints a Kotlin file, and formats it with fixes on',
    async () => {
      const root = project({
        'settings.gradle.kts': '',
        'src/main/kotlin/Main.kt': 'import java.util.*\nfun main() {\n  println("hi")  \n}\n'
      })
      const result = await runKtlint({ root, dir: '', files: ['src/main/kotlin/Main.kt'] })

      expect(result.findings.map(finding => finding.rule)).toContain('ktlint:standard:no-wildcard-imports')

      await runKtlint({ root, dir: '', files: ['src/main/kotlin/Main.kt'], write: true })

      expect(readFileSync(join(root, 'src/main/kotlin/Main.kt'), 'utf8')).not.toContain('  \n')
    },
    120_000
  )
})
