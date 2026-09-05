import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import electronBuilder from 'electron-builder'
import { collectReleaseArtifacts } from './release-artifacts.mjs'

const { publishArtifactsWithOptions } = electronBuilder
const distDir = resolve('dist')
const { version } = JSON.parse(await readFile(resolve('package.json'), 'utf8'))
const artifacts = await collectReleaseArtifacts(distDir, version)

const result = await publishArtifactsWithOptions(
  artifacts.map((file) => ({ file, arch: null })),
  undefined,
  undefined,
  undefined,
  { publish: 'always' },
)

if (result === null) {
  throw new Error('Publishing verified artifacts failed')
}
