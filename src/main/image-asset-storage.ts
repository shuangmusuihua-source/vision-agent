import { randomUUID } from 'crypto'
import { lstat, mkdir, readFile, writeFile } from 'fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'path'
import { MAX_PASTED_IMAGE_BYTES } from '../shared/image-assets'

const IMAGE_ASSET_DIRECTORY = '.sumi-assets'

type AuthorizePath = (filePath: string) => boolean

export interface PastedImageAssetRequest {
  documentPath: string
  mimeType: string
  bytes: Uint8Array
}

export interface ReadImageAssetRequest {
  documentPath: string
  relativePath: string
}

export type ImageAssetWriteResult =
  | { success: true; relativePath: string }
  | { success: false; error: string }

export type ImageAssetReadResult =
  | { success: true; mimeType: string; bytes: Uint8Array }
  | { success: false; error: string }

function hasBytes(bytes: Uint8Array, offset: number, expected: number[]): boolean {
  return expected.every((value, index) => bytes[offset + index] === value)
}

export function detectImageMimeType(bytes: Uint8Array): string | null {
  if (bytes.byteLength >= 8 && hasBytes(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'image/png'
  }
  if (bytes.byteLength >= 3 && hasBytes(bytes, 0, [0xff, 0xd8, 0xff])) {
    return 'image/jpeg'
  }
  if (
    bytes.byteLength >= 6
    && hasBytes(bytes, 0, [0x47, 0x49, 0x46, 0x38])
    && (bytes[4] === 0x37 || bytes[4] === 0x39)
    && bytes[5] === 0x61
  ) {
    return 'image/gif'
  }
  if (
    bytes.byteLength >= 12
    && hasBytes(bytes, 0, [0x52, 0x49, 0x46, 0x46])
    && hasBytes(bytes, 8, [0x57, 0x45, 0x42, 0x50])
  ) {
    return 'image/webp'
  }
  return null
}

function extensionForMimeType(mimeType: string): string | null {
  switch (mimeType) {
    case 'image/png': return 'png'
    case 'image/jpeg': return 'jpg'
    case 'image/gif': return 'gif'
    case 'image/webp': return 'webp'
    default: return null
  }
}

function normalizeBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  }
  return null
}

export function resolveImageAssetReference(documentPath: string, relativePath: string): string | null {
  if (!relativePath || relativePath.includes('\0') || isAbsolute(relativePath)) return null
  if (/^[a-z][a-z0-9+.-]*:/i.test(relativePath)) return null
  if (relativePath.includes('?') || relativePath.includes('#')) return null

  let decoded: string
  try {
    decoded = decodeURIComponent(relativePath).replace(/\\/g, '/')
  } catch {
    return null
  }
  if (!decoded || isAbsolute(decoded)) return null
  return resolve(dirname(documentPath), decoded)
}

export async function savePastedImageAsset(
  request: PastedImageAssetRequest,
  authorize: AuthorizePath,
): Promise<ImageAssetWriteResult> {
  if (!request || typeof request.documentPath !== 'string' || !authorize(request.documentPath)) {
    return { success: false, error: 'Document path not authorized' }
  }

  const documentStat = await lstat(request.documentPath).catch(() => null)
  if (!documentStat?.isFile()) {
    return { success: false, error: 'Document does not exist' }
  }

  const bytes = normalizeBytes(request.bytes)
  if (!bytes || bytes.byteLength === 0 || bytes.byteLength > MAX_PASTED_IMAGE_BYTES) {
    return { success: false, error: 'Image size is invalid or exceeds 20 MB' }
  }

  const detectedMimeType = detectImageMimeType(bytes)
  const extension = detectedMimeType ? extensionForMimeType(detectedMimeType) : null
  if (
    !detectedMimeType
    || !extension
    || typeof request.mimeType !== 'string'
    || !request.mimeType.startsWith('image/')
  ) {
    return { success: false, error: 'Unsupported or invalid image data' }
  }

  const assetDirectory = join(dirname(request.documentPath), IMAGE_ASSET_DIRECTORY)
  const destinationPath = join(assetDirectory, `pasted-${Date.now()}-${randomUUID()}.${extension}`)
  if (!authorize(assetDirectory) || !authorize(destinationPath)) {
    return { success: false, error: 'Image asset path not authorized' }
  }

  try {
    await mkdir(assetDirectory, { recursive: true })
    if (!authorize(destinationPath)) {
      return { success: false, error: 'Image asset path not authorized' }
    }
    await writeFile(destinationPath, bytes, { flag: 'wx' })
    const markdownPath = relative(dirname(request.documentPath), destinationPath).split(sep).join('/')
    return { success: true, relativePath: `./${markdownPath}` }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function readImageAsset(
  request: ReadImageAssetRequest,
  authorize: AuthorizePath,
): Promise<ImageAssetReadResult> {
  if (!request || typeof request.documentPath !== 'string' || !authorize(request.documentPath)) {
    return { success: false, error: 'Document path not authorized' }
  }

  const assetPath = resolveImageAssetReference(request.documentPath, request.relativePath)
  if (!assetPath || !authorize(assetPath)) {
    return { success: false, error: 'Image asset path not authorized' }
  }

  const assetStat = await lstat(assetPath).catch(() => null)
  if (!assetStat?.isFile() || assetStat.size <= 0 || assetStat.size > MAX_PASTED_IMAGE_BYTES) {
    return { success: false, error: 'Image asset is invalid or exceeds 20 MB' }
  }

  try {
    const bytes = new Uint8Array(await readFile(assetPath))
    const mimeType = detectImageMimeType(bytes)
    if (!mimeType) return { success: false, error: 'Unsupported or invalid image data' }
    return { success: true, mimeType, bytes }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}
