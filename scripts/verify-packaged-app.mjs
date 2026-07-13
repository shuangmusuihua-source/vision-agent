import { access } from 'fs/promises'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { listPackage } from '@electron/asar'

const repoRoot = join(fileURLToPath(new URL('..', import.meta.url)))
const appAsarPath = process.env.SUMI_PACKAGED_APP_ASAR
  || join(repoRoot, 'dist', 'mac-arm64', 'sumi.app', 'Contents', 'Resources', 'app.asar')

const allowedTopLevelPaths = new Set(['/node_modules', '/out', '/package.json'])
const requiredPaths = ['/node_modules', '/out/main/index.js', '/out/preload/index.js', '/out/renderer/index.html', '/package.json']
const forbiddenPrefixes = ['/.vision', '/scripts', '/skills-lock.json']

try {
  await access(appAsarPath)
} catch {
  console.error(`Packaged app verification failed: app.asar is missing at ${appAsarPath}`)
  process.exit(1)
}

const packagedPaths = listPackage(appAsarPath)
const packagedPathSet = new Set(packagedPaths)
const topLevelPaths = new Set(packagedPaths.map((path) => `/${path.split('/')[1]}`))
const failures = []

for (const path of topLevelPaths) {
  if (!allowedTopLevelPaths.has(path)) failures.push(`unexpected top-level path: ${path}`)
}

for (const path of requiredPaths) {
  if (!packagedPathSet.has(path)) failures.push(`required runtime path is missing: ${path}`)
}

for (const prefix of forbiddenPrefixes) {
  if (packagedPaths.some((path) => path === prefix || path.startsWith(`${prefix}/`))) {
    failures.push(`forbidden path was packaged: ${prefix}`)
  }
}

if (packagedPaths.some((path) => path.endsWith('.map'))) {
  failures.push('source map files were packaged')
}

if (failures.length > 0) {
  console.error('Packaged app verification failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(`Verified packaged app allowlist in ${appAsarPath}`)
