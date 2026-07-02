import { isAbsolute, relative, resolve, sep } from 'path'
import { extractToolPathInput, isToolUsePathAuthorized } from './agent-path-utils'

export type SessionFileAccessDecision = 'allow' | 'prompt' | 'deny' | 'not-file-tool'

const READ_TOOLS = new Set(['Read', 'Glob', 'Grep'])
const WRITE_TOOLS = new Set(['Write', 'Edit'])

function isWithinPath(candidate: string, parent: string): boolean {
  const relativePath = relative(resolve(parent), resolve(candidate))
  return relativePath === ''
    || (relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath))
}

function isProtectedRuntimePath(candidate: string, workingDirectory: string): boolean {
  const relativePath = relative(resolve(workingDirectory), resolve(candidate))
  if (!relativePath || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) return false
  const firstSegment = relativePath.split(sep)[0]
  return firstSegment === '.claude'
    || relativePath === '.mcp.json'
    || relativePath === 'CLAUDE.md'
    || relativePath === 'CLAUDE.local.md'
}

export function extractExplicitAbsolutePaths(text: string): string[] {
  const paths = new Set<string>()
  const quotedPatterns = [
    /"(\/[^"\r\n]+)"/g,
    /'(\/[^'\r\n]+)'/g,
    /`(\/[^`\r\n]+)`/g,
  ]
  for (const pattern of quotedPatterns) {
    for (const match of text.matchAll(pattern)) {
      if (match[1]) paths.add(resolve(match[1].trim()))
    }
  }

  const tokenPattern = /(?:^|[\s:：(（\[])(\/(?!\/)[^\s"'`，。；;!?！？、)\]}]+)/g
  for (const match of text.matchAll(tokenPattern)) {
    if (match[1]) paths.add(resolve(match[1].trim()))
  }
  return [...paths]
}

export function decideSessionFileAccess(options: {
  toolName: string
  input: Record<string, unknown>
  workingDirectory: string
  skillsDirectory: string
  authorizedExternalReadPaths?: string[]
  explicitExternalPaths?: string[]
}): SessionFileAccessDecision {
  const { toolName, input, workingDirectory, skillsDirectory } = options
  if (toolName === 'Bash') return 'prompt'

  let defaultRoots: string[]
  if (READ_TOOLS.has(toolName)) {
    defaultRoots = [workingDirectory, skillsDirectory, ...(options.authorizedExternalReadPaths || [])]
  } else if (WRITE_TOOLS.has(toolName)) {
    defaultRoots = [workingDirectory]
  } else {
    return 'not-file-tool'
  }

  const rawPath = extractToolPathInput(toolName, input)
  if (WRITE_TOOLS.has(toolName) && rawPath) {
    const requestedPath = resolve(workingDirectory, rawPath)
    if (isProtectedRuntimePath(requestedPath, workingDirectory)) return 'deny'
  }

  if (isToolUsePathAuthorized(toolName, input, defaultRoots, { cwd: workingDirectory })) {
    return 'allow'
  }

  if (!rawPath) return 'deny'
  const requestedPath = resolve(workingDirectory, rawPath)
  const explicitlyProvided = (options.explicitExternalPaths || [])
    .filter(isAbsolute)
    .some((externalPath) => isWithinPath(requestedPath, externalPath))
  return explicitlyProvided ? 'prompt' : 'deny'
}
