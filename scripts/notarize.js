const { notarize } = require('electron-notarize')

exports.default = async function notarizing(context) {
  const appName = context.packager.appInfo.productFilename
  const appOutDir = context.appOutDir
  const appPath = `${appOutDir}/${appName}.app`

  console.log(`[Notarize] Starting notarization for ${appPath}`)

  const appleId = process.env.APPLE_ID
  const applePassword = process.env.APPLE_PASSWORD
  const teamId = process.env.APPLE_TEAM_ID

  if (!appleId || !applePassword || !teamId) {
    console.warn('[Notarize] Skipping: APPLE_ID, APPLE_PASSWORD, or APPLE_TEAM_ID not set')
    return
  }

  return await notarize({
    appPath,
    appleId,
    applePassword,
    teamId
  })
}