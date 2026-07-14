import { readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import electronBuilder from 'electron-builder'

const { publishArtifactsWithOptions } = electronBuilder
const distDir = resolve('dist')
const names = await readdir(distDir)
const artifactNames = names.filter((name) =>
  name.endsWith('.dmg')
  || name.endsWith('.zip')
  || name.endsWith('.blockmap')
  || name === 'latest-mac.yml'
)

if (!artifactNames.some((name) => name.endsWith('.dmg'))
  || !artifactNames.some((name) => name.endsWith('.zip'))
  || !artifactNames.includes('latest-mac.yml')) {
  throw new Error('Verified release artifacts are incomplete')
}

const result = await publishArtifactsWithOptions(
  artifactNames.map((name) => ({ file: resolve(distDir, name), arch: null })),
  undefined,
  undefined,
  undefined,
  { publish: 'always' },
)

if (result === null) {
  throw new Error('Publishing verified artifacts failed')
}
