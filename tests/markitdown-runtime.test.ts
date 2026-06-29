import { mkdtemp, mkdir, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  MARKITDOWN_PACKAGE_SPEC,
  MarkitdownRuntimeManager,
  buildPythonCandidates,
  isSupportedPythonVersion,
  type MarkitdownCommandRunner,
} from '../src/main/markitdown-runtime'

const temporaryDirectories: string[] = []

async function temporaryRuntimeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'sumi-markitdown-runtime-'))
  temporaryDirectories.push(root)
  return root
}

function probeOutput(options: {
  executable: string
  pythonVersion?: string
  markitdownVersion?: string | null
  supportedFormats?: string[]
}): string {
  return `__SUMI_MARKITDOWN_RUNTIME__${JSON.stringify({
    pythonVersion: '3.13.5',
    markitdownVersion: null,
    supportedFormats: [],
    ...options,
  })}\n`
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('MarkItDown runtime discovery', () => {
  it('checks the managed runtime and explicit Python locations before generic commands', () => {
    const candidates = buildPythonCandidates({
      homeDir: '/Users/test',
      managedPythonPath: '/app/runtime/bin/python3',
      cachedPythonPath: '/cached/python3',
      env: { SUMI_PYTHON: '/custom/python3' },
    })

    expect(candidates.slice(0, 3)).toEqual([
      '/app/runtime/bin/python3',
      '/cached/python3',
      '/custom/python3',
    ])
    expect(candidates).toContain('/opt/homebrew/bin/python3')
    expect(candidates).toContain('/usr/local/bin/python3')
  })

  it('accepts Python 3.10 and newer', () => {
    expect(isSupportedPythonVersion('3.9.18')).toBe(false)
    expect(isSupportedPythonVersion('3.10.0')).toBe(true)
    expect(isSupportedPythonVersion('3.13.5')).toBe(true)
    expect(isSupportedPythonVersion('4.0.0')).toBe(true)
  })

  it('reuses an external Python that already has the requested conversion support', async () => {
    const runtimeRoot = await temporaryRuntimeRoot()
    const runner: MarkitdownCommandRunner = async (command) => {
      if (command !== '/opt/homebrew/bin/python3') throw new Error('not found')
      return {
        stdout: probeOutput({
          executable: command,
          markitdownVersion: '0.1.6',
          supportedFormats: ['pdf', 'docx', 'pptx', 'xlsx'],
        }),
        stderr: '',
      }
    }
    const manager = new MarkitdownRuntimeManager({
      runtimeRoot,
      candidates: ['/opt/homebrew/bin/python3'],
      runCommand: runner,
    })

    const status = await manager.getStatus(['pdf'])

    expect(status).toMatchObject({
      state: 'ready',
      source: 'external',
      pythonPath: '/opt/homebrew/bin/python3',
      markitdownVersion: '0.1.6',
    })
  })

  it('offers an isolated install when Python is usable but MarkItDown is missing', async () => {
    const runtimeRoot = await temporaryRuntimeRoot()
    const manager = new MarkitdownRuntimeManager({
      runtimeRoot,
      candidates: ['/usr/bin/python3'],
      runCommand: async (command) => {
        if (command !== '/usr/bin/python3') throw new Error('not found')
        return {
          stdout: probeOutput({ executable: command, pythonVersion: '3.11.9' }),
          stderr: '',
        }
      },
    })

    await expect(manager.getStatus(['pdf'])).resolves.toMatchObject({
      state: 'installable',
      pythonPath: '/usr/bin/python3',
      pythonVersion: '3.11.9',
      missingFormats: ['pdf'],
    })
  })

  it('installs the focused format extras into the managed runtime', async () => {
    const runtimeRoot = await temporaryRuntimeRoot()
    const managedPython = join(runtimeRoot, 'venv', 'bin', 'python3')
    let installed = false
    const calls: Array<{ command: string; args: string[] }> = []

    const runner: MarkitdownCommandRunner = async (command, args) => {
      calls.push({ command, args })

      if (args[0] === '-c') {
        if (command === '/base/python3') {
          return { stdout: probeOutput({ executable: command }), stderr: '' }
        }
        if (installed && (command === managedPython || command.includes('venv.install-'))) {
          return {
            stdout: probeOutput({
              executable: command,
              markitdownVersion: '0.1.6',
              supportedFormats: ['pdf', 'docx', 'pptx', 'xlsx'],
            }),
            stderr: '',
          }
        }
        throw new Error('not found')
      }

      if (args[0] === '-m' && args[1] === 'venv') {
        await mkdir(args[3], { recursive: true })
        return { stdout: '', stderr: '' }
      }
      if (args[0] === '-m' && args[1] === 'pip') {
        installed = true
        return { stdout: '', stderr: '' }
      }
      throw new Error('unexpected command')
    }

    const manager = new MarkitdownRuntimeManager({
      runtimeRoot,
      candidates: ['/base/python3'],
      runCommand: runner,
    })
    const result = await manager.install()

    expect(result).toMatchObject({
      success: true,
      status: { state: 'ready', source: 'managed', markitdownVersion: '0.1.6' },
    })
    expect(calls.some(call => call.args.includes(MARKITDOWN_PACKAGE_SPEC))).toBe(true)
  })
})
