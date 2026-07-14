import { existsSync, realpathSync } from 'fs'
import { basename, dirname, isAbsolute, resolve, sep } from 'path'

export interface PathAuthorizationOptions {
  cwd?: string
}

const TOOL_PATH_FIELDS: Record<string, string> = {
  Read: 'file_path',
  Write: 'file_path',
  Edit: 'file_path',
  Glob: 'path',
  Grep: 'path',
}

export function extractToolPathInput(toolName: string, input: Record<string, unknown>): string | null {
  const field = TOOL_PATH_FIELDS[toolName]
  if (!field) return null
  const value = input[field]
  return typeof value === 'string' && value.trim() ? value : null
}

export function toolRequiresPath(toolName: string): boolean {
  return toolName === 'Read' || toolName === 'Write' || toolName === 'Edit'
}

export function isToolUsePathAuthorized(
  toolName: string,
  input: Record<string, unknown>,
  authorizedDirs: string[],
  options: PathAuthorizationOptions = {}
): boolean {
  const filePath = extractToolPathInput(toolName, input)
  if (!filePath) {
    if (toolRequiresPath(toolName)) return false
    return isPathAuthorized('.', authorizedDirs, options)
  }
  return isPathAuthorized(filePath, authorizedDirs, options)
}

function resolveAgainstCwd(filePath: string, cwd?: string): string {
  if (isAbsolute(filePath)) return resolve(filePath)
  return resolve(cwd || process.cwd(), filePath)
}

function realpathForAuthorization(filePath: string): string {
  const resolved = resolve(filePath)
  if (existsSync(resolved)) {
    return realpathSync.native(resolved)
  }

  const parent = dirname(resolved)
  if (parent === resolved) return resolved
  return resolve(realpathForAuthorization(parent), basename(resolved))
}

/**
 * Check if a file path is within any of the authorized directories.
 * Both the file path and directory roots are resolved through realpath where possible,
 * so symlinks cannot escape an authorized root.
 *
 * @param filePath - The file path to check
 * @param authorizedDirs - Array of authorized directory paths
 * @param options.cwd - Base directory for resolving relative file paths
 * @returns true if the file path is within an authorized directory
 */
export function isPathAuthorized(
  filePath: string,
  authorizedDirs: string[],
  options: PathAuthorizationOptions = {}
): boolean {
  const resolved = realpathForAuthorization(resolveAgainstCwd(filePath, options.cwd))
  return authorizedDirs.some(dir => {
    const resolvedDir = realpathForAuthorization(resolve(dir))
    return resolved === resolvedDir || resolved.startsWith(resolvedDir + sep)
  })
}

/** Check whether a path canonically matches one of the authorized roots. */
export function isExactAuthorizedRoot(filePath: string, authorizedDirs: string[]): boolean {
  return authorizedDirs.some((dir) =>
    isPathAuthorized(filePath, [dir]) && isPathAuthorized(dir, [filePath])
  )
}
