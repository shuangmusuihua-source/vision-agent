import { readFile, readdir, stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, join } from 'node:path'
import { load } from 'js-yaml'

// The updater manifest defines this build's artifact set. A reused dist
// directory can also contain older versions that must never be uploaded.
export async function collectReleaseArtifacts(distDir, version) {
  const manifestName = 'latest-mac.yml'
  const manifest = load(await readFile(join(distDir, manifestName), 'utf8'))
  if (manifest?.version !== version || !Array.isArray(manifest.files)) {
    throw new Error('Release manifest does not match the current package version')
  }
  const available = new Set(await readdir(distDir))
  const names = new Set()
  for (const entry of manifest.files) {
    const name = entry.url
    if (typeof name !== 'string' || basename(name) !== name || /[\\/%]/.test(name)
      || !name.includes(`-${version}-`) || !/\.(dmg|zip)$/.test(name)) {
      throw new Error('Invalid release artifact name')
    }
    const file = join(distDir, name)
    const info = await stat(file)
    if (!info.isFile() || info.size !== entry.size) throw new Error(`Release artifact size mismatch: ${name}`)
    const hash = createHash('sha512')
    for await (const chunk of createReadStream(file)) hash.update(chunk)
    if (hash.digest('base64') !== entry.sha512) throw new Error(`Release artifact hash mismatch: ${name}`)
    names.add(name)
    if (available.has(`${name}.blockmap`)) names.add(`${name}.blockmap`)
  }
  if (![...names].some((name) => name.endsWith('.dmg')) || ![...names].some((name) => name.endsWith('.zip'))) {
    throw new Error('Verified release artifacts are incomplete')
  }
  return [...names, manifestName].map((name) => join(distDir, name))
}
