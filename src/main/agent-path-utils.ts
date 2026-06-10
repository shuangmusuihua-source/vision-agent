import { resolve, sep } from 'path'

/**
 * Check if a file path is within any of the authorized directories.
 * Both the file path and directory roots are resolved to absolute paths before comparison.
 *
 * @param filePath - The file path to check
 * @param authorizedDirs - Array of authorized directory paths
 * @returns true if the file path is within an authorized directory
 */
export function isPathAuthorized(filePath: string, authorizedDirs: string[]): boolean {
  const resolved = resolve(filePath)
  return authorizedDirs.some(dir => {
    const resolvedDir = resolve(dir)
    return resolved === resolvedDir || resolved.startsWith(resolvedDir + sep)
  })
}
