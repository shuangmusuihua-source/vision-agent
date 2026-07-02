import { execFile } from 'child_process'
import { createHash } from 'crypto'
import { mkdir, writeFile } from 'fs/promises'
import { basename, extname, join, resolve } from 'path'
import { ATTACHMENT_CONVERSION_CONTEXT_TAG } from '../shared/file-attachments'
import { getMarkitdownRuntimeManager } from './markitdown-runtime'
import type { MarkitdownFormat } from '../shared/markitdown-runtime'
import { MARKITDOWN_FORMATS } from '../shared/markitdown-runtime'
import { consumeAttachmentPathGrant } from './attachment-path-authorization'

export interface AttachmentConversionRef {
  sourcePath: string
  markdownPath: string
}

export interface AttachmentConversionFailure {
  sourcePath: string
  error: string
}

export interface AttachmentConversionResult {
  converted: AttachmentConversionRef[]
  failed: AttachmentConversionFailure[]
}

export interface AttachmentConversionRequest {
  sourcePath: string
  grantId?: string
}

export type AttachmentReferenceRequest = AttachmentConversionRequest

const FILE_CONVERT_MARKER_REGEX = /<!--FILE_CONVERT:([\s\S]*?)-->\n?/
const FILE_ATTACHMENT_MARKER_REGEX = /<!--FILE_ATTACH:([\s\S]*?)-->\n?/
const MARKITDOWN_TIMEOUT_MS = 30000
const MARKITDOWN_MAX_BUFFER_BYTES = 50 * 1024 * 1024

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function parseFileConvertRequests(prompt: string): AttachmentConversionRequest[] {
  const match = prompt.match(FILE_CONVERT_MARKER_REGEX)
  if (!match) return []

  return match[1]
    .split('|')
    .map((rawToken) => {
      const token = rawToken.trim()
      const separatorIndex = token.indexOf('@')
      if (separatorIndex <= 0) {
        return { sourcePath: safeDecodeURIComponent(token) }
      }
      return {
        grantId: token.slice(0, separatorIndex),
        sourcePath: safeDecodeURIComponent(token.slice(separatorIndex + 1)),
      }
    })
    .filter((request) => Boolean(request.sourcePath))
}

export function parseFileConvertPaths(prompt: string): string[] {
  return parseFileConvertRequests(prompt).map((request) => request.sourcePath)
}

export function parseAttachmentReferenceRequests(prompt: string): AttachmentReferenceRequest[] {
  const match = prompt.match(FILE_ATTACHMENT_MARKER_REGEX)
  if (!match) return []
  return match[1]
    .split('|')
    .map((rawToken) => {
      const token = rawToken.trim()
      const separatorIndex = token.indexOf('@')
      if (separatorIndex <= 0) {
        return { sourcePath: safeDecodeURIComponent(token) }
      }
      return {
        grantId: token.slice(0, separatorIndex),
        sourcePath: safeDecodeURIComponent(token.slice(separatorIndex + 1)),
      }
    })
    .filter((request) => Boolean(request.sourcePath))
}

export function parseAttachmentReferencePaths(prompt: string): string[] {
  return parseAttachmentReferenceRequests(prompt).map((request) => request.sourcePath)
}

export function claimPromptAttachments(prompt: string): {
  attachmentPaths: string[]
  convertRequests: AttachmentConversionRequest[]
} {
  const attachmentRequests = parseAttachmentReferenceRequests(prompt)
  const attachmentPaths: string[] = []
  for (const request of attachmentRequests) {
    if (!consumeAttachmentPathGrant(request.grantId, request.sourcePath)) {
      throw new Error('附件路径未获得授权，请重新选择文件')
    }
    attachmentPaths.push(request.sourcePath)
  }

  const convertRequests = parseFileConvertRequests(prompt)
  const authorizedConversions = new Set(attachmentRequests.map((request) => (
    `${request.grantId || ''}\u0000${resolve(request.sourcePath)}`
  )))
  if (convertRequests.some((request) => (
    !authorizedConversions.has(`${request.grantId || ''}\u0000${resolve(request.sourcePath)}`)
  ))) {
    throw new Error('附件转换请求与用户选择的文件不一致')
  }

  return { attachmentPaths, convertRequests }
}

export function stripFileConvertMarker(prompt: string): string {
  return prompt
    .replace(FILE_CONVERT_MARKER_REGEX, '')
    .replace(FILE_ATTACHMENT_MARKER_REGEX, '')
    .trim()
}

export function safeAttachmentSegment(value: string | undefined, fallback = 'session'): string {
  const cleaned = (value || fallback)
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96)

  return cleaned || fallback
}

function hashPath(filePath: string): string {
  return createHash('sha256').update(filePath).digest('hex').slice(0, 10)
}

function convertedMarkdownPath(workspaceCwd: string, sessionKey: string, filePath: string): string {
  const baseName = basename(filePath).replace(/\.[^.]+$/, '')
  const safeBaseName = safeAttachmentSegment(baseName, 'attachment')
  const outName = `${safeBaseName}-${hashPath(filePath)}.md`

  return join(workspaceCwd, '.vision', 'attachments', safeAttachmentSegment(sessionKey), outName)
}

async function runMarkitdown(filePath: string): Promise<string> {
  const format = extname(filePath).slice(1).toLowerCase() as MarkitdownFormat
  if (!MARKITDOWN_FORMATS.includes(format)) {
    throw new Error('不支持的附件格式')
  }
  const runtime = await getMarkitdownRuntimeManager().getStatus([format])
  if (runtime.state !== 'ready') {
    throw new Error('附件解析组件尚未安装')
  }

  return new Promise((resolve, reject) => {
    execFile(runtime.pythonPath, ['-m', 'markitdown', filePath], {
      encoding: 'utf-8',
      timeout: MARKITDOWN_TIMEOUT_MS,
      maxBuffer: MARKITDOWN_MAX_BUFFER_BYTES,
    }, (err, stdout, stderr) => {
      if (err) {
        if (stderr) {
          err.message = `${err.message}\n${stderr}`
        }
        reject(err)
        return
      }

      resolve(stdout)
    })
  })
}

export async function convertAttachmentsToMarkdown(
  workspaceCwd: string,
  sessionKey: string,
  requests: AttachmentConversionRequest[]
): Promise<AttachmentConversionResult> {
  const result: AttachmentConversionResult = { converted: [], failed: [] }
  const outDir = join(workspaceCwd, '.vision', 'attachments', safeAttachmentSegment(sessionKey))
  await mkdir(outDir, { recursive: true })

  for (const request of requests) {
    const filePath = request.sourcePath
    try {
      const markdownPath = convertedMarkdownPath(workspaceCwd, sessionKey, filePath)
      const markdown = await runMarkitdown(filePath)
      await writeFile(markdownPath, markdown, 'utf-8')
      result.converted.push({ sourcePath: filePath, markdownPath })
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      console.error(`[FileConvert] ${filePath}:`, error)
      result.failed.push({ sourcePath: filePath, error })
    }
  }

  return result
}

export function appendAttachmentConversionSummary(
  prompt: string,
  conversion: AttachmentConversionResult
): string {
  const lines: string[] = []

  if (conversion.converted.length > 0) {
    lines.push(
      '附件转换结果：',
      '以下文件已转换为 Markdown。请优先使用 Read 工具读取 Markdown 路径，而不是直接读取原始文件：'
    )
    for (const ref of conversion.converted) {
      lines.push(`- 源文件: ${ref.sourcePath}`, `  Markdown路径: ${ref.markdownPath}`)
    }
  }

  if (conversion.failed.length > 0) {
    if (lines.length > 0) lines.push('')
    lines.push(
      '附件转换失败：',
      '这些文件暂时无法转换，请告知用户重新选择文件或检查文件是否仍存在：'
    )
    for (const failure of conversion.failed) {
      lines.push(`- 源文件: ${failure.sourcePath}`, `  错误: ${failure.error}`)
    }
  }

  if (lines.length === 0) return prompt
  return [
    prompt,
    `<${ATTACHMENT_CONVERSION_CONTEXT_TAG}>`,
    lines.join('\n'),
    `</${ATTACHMENT_CONVERSION_CONTEXT_TAG}>`,
  ].join('\n\n').trim()
}
