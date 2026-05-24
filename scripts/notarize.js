const { notarize } = require('@electron/notarize')

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context
  if (electronPlatformName !== 'darwin') return

  // Support both legacy Apple ID auth and new App Store Connect API Key auth
  const appleId = process.env.APPLE_ID
  const applePassword = process.env.APPLE_PASSWORD
  const appleTeamId = process.env.APPLE_TEAM_ID
  const appleApiIssuer = process.env.APPLE_API_ISSUER
  const appleApiKeyId = process.env.APPLE_API_KEY_ID
  const appleApiKeyPath = process.env.APPLE_API_KEY_PATH

  const hasApiKeyAuth = appleApiIssuer && appleApiKeyId && appleApiKeyPath
  const hasAppleIdAuth = appleId && applePassword && appleTeamId

  if (!hasApiKeyAuth && !hasAppleIdAuth) {
    console.log('Skipping notarization: no Apple credentials found in environment variables.')
    console.log('Set APPLE_API_ISSUER, APPLE_API_KEY_ID, APPLE_API_KEY_PATH for API Key auth,')
    console.log('or APPLE_ID, APPLE_PASSWORD, APPLE_TEAM_ID for legacy auth.')
    return
  }

  const appName = context.packager.appInfo.productFilename

  const opts = {
    appPath: `${appOutDir}/${appName}.app`,
  }

  if (hasApiKeyAuth) {
    opts.appleApiIssuer = appleApiIssuer
    opts.appleApiKeyId = appleApiKeyId
    opts.appleApiKeyPath = appleApiKeyPath
  } else {
    opts.appleId = appleId
    opts.applePassword = applePassword
    opts.appleTeamId = appleTeamId
  }

  console.log(`Notarizing ${appName}...`)
  await notarize(opts)
  console.log('Notarization complete.')
}
