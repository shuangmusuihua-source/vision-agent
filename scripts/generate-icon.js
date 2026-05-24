const { execSync, mkdirSync, writeFileSync, existsSync } = require('fs')
const { join } = require('path')

// Generate SVG icon for Vision Agent
// Design: rounded square with a stylized eye/vision symbol
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#6366f1"/>
      <stop offset="100%" style="stop-color:#8b5cf6"/>
    </linearGradient>
    <linearGradient id="eye" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#ffffff;stop-opacity:0.95"/>
      <stop offset="100%" style="stop-color:#e0e7ff;stop-opacity:0.95"/>
    </linearGradient>
  </defs>
  <!-- Rounded square background -->
  <rect x="48" y="48" width="928" height="928" rx="200" ry="200" fill="url(#bg)"/>
  <!-- Eye shape - outer -->
  <ellipse cx="512" cy="480" rx="260" ry="140" fill="none" stroke="url(#eye)" stroke-width="48" stroke-linecap="round"/>
  <!-- Eye - iris -->
  <circle cx="512" cy="480" r="80" fill="url(#eye)"/>
  <!-- Eye - pupil -->
  <circle cx="512" cy="480" r="36" fill="#4338ca"/>
  <!-- Sparkle -->
  <circle cx="536" cy="456" r="14" fill="white" opacity="0.9"/>
  <!-- Agent/terminal accent - small dot cluster below -->
  <circle cx="420" cy="680" r="16" fill="#c4b5fd" opacity="0.8"/>
  <circle cx="472" cy="680" r="16" fill="#a78bfa" opacity="0.8"/>
  <circle cx="524" cy="680" r="16" fill="#8b5cf6" opacity="0.8"/>
  <!-- Subtle shine on top-left -->
  <ellipse cx="320" cy="240" rx="180" ry="80" fill="white" opacity="0.08" transform="rotate(-30 320 240)"/>
</svg>`

const projectRoot = join(__dirname, '..')
const iconsetDir = join(projectRoot, 'build', 'icon.iconset')

// Write SVG
const svgPath = join(projectRoot, 'build', 'icon.svg')
mkdirSync(join(projectRoot, 'build'), { recursive: true })
writeFileSync(svgPath, svg)
console.log('SVG written to', svgPath)

// Create iconset directory
mkdirSync(iconsetDir, { recursive: true })

// Use sips to convert SVG to PNGs at required sizes
const sizes = [
  { name: 'icon_16x16.png', size: 16 },
  { name: 'icon_16x16@2x.png', size: 32 },
  { name: 'icon_32x32.png', size: 32 },
  { name: 'icon_32x32@2x.png', size: 64 },
  { name: 'icon_128x128.png', size: 128 },
  { name: 'icon_128x128@2x.png', size: 256 },
  { name: 'icon_256x256.png', size: 256 },
  { name: 'icon_256x256@2x.png', size: 512 },
  { name: 'icon_512x512.png', size: 512 },
  { name: 'icon_512x512@2x.png', size: 1024 },
]

// First create a 1024x1024 PNG from SVG using sips
const basePng = join(iconsetDir, 'icon_512x512@2x.png')
try {
  execSync(`sips -s format png --resampleWidth 1024 "${svgPath}" --out "${basePng}"`, { stdio: 'inherit' })
} catch (e) {
  console.error('sips failed, trying with qlmanage...')
  // Fallback: use qlmanage to render SVG
  execSync(`qlmanage -t -s 1024 -o "${iconsetDir}" "${svgPath}"`, { stdio: 'inherit' })
  const generated = join(iconsetDir, 'icon.svg.png')
  if (existsSync(generated)) {
    execSync(`mv "${generated}" "${basePng}"`)
  }
}

// Generate all sizes from the base 1024 PNG
for (const { name, size } of sizes) {
  const outPath = join(iconsetDir, name)
  execSync(`sips -s format png --resampleWidth ${size} "${basePng}" --out "${outPath}"`, { stdio: 'pipe' })
  console.log(`  Created ${name} (${size}x${size})`)
}

// Convert iconset to icns
const icnsPath = join(projectRoot, 'build', 'icon.icns')
execSync(`iconutil -c icns "${iconsetDir}" -o "${icnsPath}"`)
console.log('ICNS written to', icnsPath)

// Clean up iconset
execSync(`rm -rf "${iconsetDir}"`)
console.log('Done!')
