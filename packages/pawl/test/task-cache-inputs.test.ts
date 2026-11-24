import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { analyzeTaskReachability } from '../src/project/task-reachability.ts'
import { isRecord } from '../src/utils/json.ts'
import { PACKAGE_ROOT, project, write } from './helpers.ts'

const turbo = join(PACKAGE_ROOT, '../../node_modules/.bin/turbo')
const taskHash = (
  root: string,
  value: string,
  orchestration: string,
  sandbox = 'sandbox-a',
  name = 'build'
): string => {
  const text = execFileSync(turbo, ['run', name, '--dry=json'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30_000,
    env: {
      ...process.env,
      TURBO_TELEMETRY_DISABLED: '1',
      PAWL_BUILD_INPUT: value,
      PAWL_ORCHESTRATION_INPUT: orchestration,
      PAWL_TEST_SANDBOX: sandbox
    }
  })
  const output: unknown = JSON.parse(text)
  if (!isRecord(output) || !Array.isArray(output.tasks)) throw new Error('Invalid Turbo dry-run report')
  const task: unknown = output.tasks.find((value: unknown) => isRecord(value) && value.task === name)
  if (!isRecord(task) || typeof task.hash !== 'string') throw new Error('Missing build task hash')
  return task.hash
}

describe('documented task input ownership against real Turbo', () => {
  it('hashes output-affecting inputs without making orchestration variables global inputs', () => {
    const root = project({
      'package.json': {
        name: 'task-input-contract',
        private: true,
        type: 'module',
        packageManager: 'pnpm@11.6.0',
        scripts: { build: 'node scripts/build.js', deploy: 'node scripts/deploy.js' }
      },
      'pnpm-lock.yaml': "lockfileVersion: '9.0'\nimporters:\n  .: {}\n",
      'turbo.json': { tasks: { build: { env: ['PAWL_BUILD_INPUT'], outputs: ['output.txt'] } } },
      'scripts/build.js':
        "import { writeFileSync } from 'node:fs'\nwriteFileSync('output.txt', process.env.PAWL_BUILD_INPUT)\n",
      'scripts/deploy.js': 'console.log(process.env.PAWL_ORCHESTRATION_INPUT)\n'
    })
    const initial = taskHash(root, 'first', 'orchestration-a')
    expect(taskHash(root, 'second', 'orchestration-a')).not.toBe(initial)
    expect(taskHash(root, 'first', 'orchestration-b')).toBe(initial)
    expect(taskHash(root, 'first', 'orchestration-a', 'sandbox-b')).toBe(initial)
    const report = analyzeTaskReachability(root, [])
    expect(report.files.find(file => file.path === 'scripts/build.js')?.reachability).toBe('cached')
    expect(report.files.find(file => file.path === 'scripts/deploy.js')?.reachability).toBe('uncached')
    expect(report.complete).toBe(false)
  })

  it('changes each affected task hash when declared shared configuration changes', () => {
    const root = project({
      'package.json': {
        name: 'shared-task-input-contract',
        private: true,
        type: 'module',
        packageManager: 'pnpm@11.6.0',
        scripts: { build: 'node scripts/check.js', check: 'node scripts/check.js' }
      },
      'pnpm-lock.yaml': "lockfileVersion: '9.0'\nimporters:\n  .: {}\n",
      'turbo.json': {
        globalDependencies: ['shared-config.json'],
        tasks: {
          build: { inputs: ['scripts/**'] },
          check: { inputs: ['scripts/**'] }
        }
      },
      'shared-config.json': { strict: false },
      'scripts/check.js':
        "import { readFileSync } from 'node:fs'\nconsole.log(readFileSync('shared-config.json', 'utf8'))\n"
    })
    const before = ['build', 'check'].map(name => taskHash(root, 'first', 'orchestration-a', 'sandbox-a', name))
    write(root, { 'shared-config.json': { strict: true } })
    for (const [index, name] of ['build', 'check'].entries()) {
      expect(taskHash(root, 'first', 'orchestration-a', 'sandbox-a', name)).not.toBe(before[index])
    }
  })
})
