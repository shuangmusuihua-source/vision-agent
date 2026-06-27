import { readFile, readdir, stat } from 'fs/promises'
import { join, relative, sep } from 'path'
import { fileURLToPath } from 'url'

const repoRoot = join(fileURLToPath(new URL('..', import.meta.url)))
const sourceRoot = join(repoRoot, 'src', 'main', 'skills')
const packagedRoot = process.env.SUMI_PACKAGED_SKILLS_DIR
  || join(repoRoot, 'dist', 'mac-arm64', 'sumi.app', 'Contents', 'Resources', 'skills')
const manifest = JSON.parse(await readFile(join(sourceRoot, 'skills-manifest.json'), 'utf8'))

async function collectFiles(root, current = root) {
  const files = new Map()
  const entries = await readdir(current, { withFileTypes: true })

  for (const entry of entries) {
    if (entry.name === '.DS_Store' || entry.name === '.git') continue
    const fullPath = join(current, entry.name)
    if (entry.isDirectory()) {
      for (const [path, size] of await collectFiles(root, fullPath)) files.set(path, size)
      continue
    }
    if (!entry.isFile()) continue
    const fileStat = await stat(fullPath)
    files.set(relative(root, fullPath).split(sep).join('/'), fileStat.size)
  }

  return files
}

const failures = []
for (const skill of manifest.filter(item => item.hasResources)) {
  const sourceFiles = await collectFiles(join(sourceRoot, skill.id))
  let packagedFiles
  try {
    packagedFiles = await collectFiles(join(packagedRoot, skill.id))
  } catch (error) {
    failures.push(`${skill.id}: packaged directory is missing (${error.message})`)
    continue
  }

  for (const requiredPath of skill.requiredPaths) {
    try {
      await stat(join(packagedRoot, skill.id, requiredPath))
    } catch {
      failures.push(`${skill.id}: required resource is missing: ${requiredPath}`)
    }
  }

  for (const [path, size] of sourceFiles) {
    const packagedSize = packagedFiles.get(path)
    if (packagedSize === undefined) failures.push(`${skill.id}: packaged file is missing: ${path}`)
    else if (packagedSize !== size) failures.push(`${skill.id}: packaged file size differs: ${path}`)
  }
}

if (failures.length > 0) {
  console.error('Packaged Skill verification failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exitCode = 1
} else {
  console.log(`Verified ${manifest.length} complete built-in Skills in ${packagedRoot}`)
}
