import { execFile } from 'child_process'
import { createHash } from 'crypto'
import { mkdir, writeFile } from 'fs/promises'
import { basename, join } from 'path'
import { ATTACHMENT_CONVERSION_CONTEXT_TAG } from '../shared/file-attachments'

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

const FILE_CONVERT_MARKER_REGEX = /<!--FILE_CONVERT:([\s\S]*?)-->\n?/
const MARKITDOWN_TIMEOUT_MS = 30000
const MARKITDOWN_MAX_BUFFER_BYTES = 50 * 1024 * 1024

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function parseFileConvertPaths(prompt: string): string[] {
  const match = prompt.match(FILE_CONVERT_MARKER_REGEX)
  if (!match) return []

  return match[1]
    .split('|')
    .map(token => safeDecodeURIComponent(token.trim()))
    .filter(Boolean)
}

export function stripFileConvertMarker(prompt: string): string {
  return prompt.replace(FILE_CONVERT_MARKER_REGEX, '').trim()
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

function runMarkitdown(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('python3', ['-m', 'markitdown', filePath], {
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
  filePaths: string[]
): Promise<AttachmentConversionResult> {
  const result: AttachmentConversionResult = { converted: [], failed: [] }
  const outDir = join(workspaceCwd, '.vision', 'attachments', safeAttachmentSegment(sessionKey))
  await mkdir(outDir, { recursive: true })

  for (const filePath of filePaths) {
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
