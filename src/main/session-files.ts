import { createHash } from 'crypto'
import { mkdir, rm } from 'fs/promises'
import { dirname, join, relative, resolve, sep } from 'path'

const SESSION_FILES_ROOT = join('.sumi', 'sessions')
const ASK_SESSION_FILES_ROOT = join('.sumi', 'ask-sessions')

function sessionStorageKey(sessionId: string): string {
  return createHash('sha256').update(sessionId).digest('hex').slice(0, 24)
}

export function getSessionWorkingDirectory(workspacePath: string, sessionId: string): string {
  return join(resolve(workspacePath), SESSION_FILES_ROOT, sessionStorageKey(sessionId))
}

export async function ensureSessionWorkingDirectory(
  workspacePath: string,
  sessionId: string,
): Promise<string> {
  const workingDirectory = getSessionWorkingDirectory(workspacePath, sessionId)
  await mkdir(workingDirectory, { recursive: true })
  return workingDirectory
}

export function getAskSessionWorkingDirectory(appDataPath: string, sessionId: string): string {
  return join(resolve(appDataPath), ASK_SESSION_FILES_ROOT, sessionStorageKey(sessionId))
}

export async function ensureAskSessionWorkingDirectory(
  appDataPath: string,
  sessionId: string,
): Promise<string> {
  const workingDirectory = getAskSessionWorkingDirectory(appDataPath, sessionId)
  await mkdir(workingDirectory, { recursive: true })
  return workingDirectory
}

export function isManagedSessionWorkingDirectory(
  workspacePath: string,
  workingDirectory: string,
  context: 'editor' | 'ask' = 'editor',
): boolean {
  const sessionsRoot = resolve(
    workspacePath,
    context === 'ask' ? ASK_SESSION_FILES_ROOT : SESSION_FILES_ROOT,
  )
  const candidate = resolve(workingDirectory)
  const relativePath = relative(sessionsRoot, candidate)
  return Boolean(relativePath)
    && !relativePath.startsWith(`..${sep}`)
    && relativePath !== '..'
    && dirname(candidate) === sessionsRoot
}

export async function removeSessionWorkingDirectory(
  workspacePath: string,
  workingDirectory?: string,
  context: 'editor' | 'ask' = 'editor',
): Promise<boolean> {
  if (!workingDirectory || !isManagedSessionWorkingDirectory(workspacePath, workingDirectory, context)) {
    return false
  }
  await rm(workingDirectory, { recursive: true, force: true })
  return true
}
