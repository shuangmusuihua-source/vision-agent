import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { isAbsolute, join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { isPathAuthorized } from '../src/main/agent-path-utils'
import {
  detectImageMimeType,
  readImageAsset,
  resolveImageAssetReference,
  savePastedImageAsset,
} from '../src/main/image-asset-storage'

const roots: string[] = []
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function makeWorkspace() {
  const root = await mkdtemp(join(tmpdir(), 'sumi-image-assets-'))
  roots.push(root)
  const workspace = join(root, 'workspace')
  await mkdir(workspace)
  const documentPath = join(workspace, 'note.md')
  await writeFile(documentPath, '# Note')
  const authorize = (filePath: string) => isPathAuthorized(filePath, [workspace])
  return { root, workspace, documentPath, authorize }
}

describe('image asset storage', () => {
  it('stores binary image data beside the document and returns a portable Markdown reference', async () => {
    const { documentPath, authorize } = await makeWorkspace()

    const saved = await savePastedImageAsset({
      documentPath,
      mimeType: 'image/png',
      bytes: PNG_BYTES,
    }, authorize)

    expect(saved.success).toBe(true)
    if (!saved.success) return
    expect(saved.relativePath).toMatch(/^\.\/\.sumi-assets\/pasted-.+\.png$/)
    expect(saved.relativePath).not.toContain('data:')

    const assetPath = resolveImageAssetReference(documentPath, saved.relativePath)
    expect(assetPath).not.toBeNull()
    expect(isAbsolute(assetPath!)).toBe(true)
    await expect(readFile(assetPath!)).resolves.toEqual(Buffer.from(PNG_BYTES))

    const loaded = await readImageAsset({
      documentPath,
      relativePath: saved.relativePath,
    }, authorize)
    expect(loaded).toEqual({ success: true, mimeType: 'image/png', bytes: PNG_BYTES })
  })

  it('rejects malformed IPC mime values instead of throwing', async () => {
    const { documentPath, authorize } = await makeWorkspace()

    await expect(savePastedImageAsset({
      documentPath,
      mimeType: null as never,
      bytes: PNG_BYTES,
    }, authorize)).resolves.toEqual({
      success: false,
      error: 'Unsupported or invalid image data',
    })
  })

  it('rejects image assets that escape the authorized workspace through a symlink', async () => {
    const { root, workspace, documentPath, authorize } = await makeWorkspace()
    const outside = join(root, 'outside')
    await mkdir(outside)
    await symlink(outside, join(workspace, '.sumi-assets'), 'dir')

    const result = await savePastedImageAsset({
      documentPath,
      mimeType: 'image/png',
      bytes: PNG_BYTES,
    }, authorize)

    expect(result).toEqual({ success: false, error: 'Image asset path not authorized' })
  })

  it('rejects absolute and protocol-based references before reading', async () => {
    const { documentPath } = await makeWorkspace()

    expect(resolveImageAssetReference(documentPath, '/tmp/image.png')).toBeNull()
    expect(resolveImageAssetReference(documentPath, 'file:///tmp/image.png')).toBeNull()
    expect(resolveImageAssetReference(documentPath, 'https://example.com/image.png')).toBeNull()
  })

  it('recognizes only supported image signatures', () => {
    expect(detectImageMimeType(PNG_BYTES)).toBe('image/png')
    expect(detectImageMimeType(new Uint8Array([1, 2, 3]))).toBeNull()
  })
})
