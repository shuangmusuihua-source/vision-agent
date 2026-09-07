import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { collectReleaseArtifacts } from '../scripts/release-artifacts.mjs'
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))) })
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'sumi-release-test-')); roots.push(dir)
  const names = ['sumi-1.9.0-arm64.dmg', 'sumi-1.9.0-arm64-mac.zip']
  const files = names.map((url) => ({ url, size: 4, sha512: createHash('sha512').update('test').digest('base64') }))
  await Promise.all([...names, 'sumi-1.8.0-arm64.dmg', 'sumi-1.8.0-arm64-mac.zip', `${names[1]}.blockmap`].map((name) => writeFile(join(dir, name), 'test')))
  await writeFile(join(dir, 'latest-mac.yml'), JSON.stringify({ version: '1.9.0', files }))
  return { dir, names, files }
}
it('selects only the current manifest artifacts and their blockmaps from a reused dist directory', async () => {
  const { dir, names } = await fixture()
  expect((await collectReleaseArtifacts(dir, '1.9.0')).map((file: string) => basename(file))).toEqual([...names, `${names[1]}.blockmap`, 'latest-mac.yml'])
})
it('refuses stale manifests and modified installation artifacts', async () => {
  const { dir, names } = await fixture()
  await expect(collectReleaseArtifacts(dir, '2.0.0')).rejects.toThrow('version')
  await writeFile(join(dir, names[0]), 'evil')
  await expect(collectReleaseArtifacts(dir, '1.9.0')).rejects.toThrow('hash mismatch')
})
it('rejects files outside the release directory', async () => {
  const { dir, files } = await fixture()
  files[0].url = '../outside.dmg'
  await writeFile(join(dir, 'latest-mac.yml'), JSON.stringify({ version: '1.9.0', files }))
  await expect(collectReleaseArtifacts(dir, '1.9.0')).rejects.toThrow('artifact name')
})
