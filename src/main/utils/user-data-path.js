const os = require('os')
const path = require('path')

const FIXED_USER_DATA_APP_NAME = 'cc-desktop'

function getStableUserDataPath(platform = process.platform, env = process.env, homeDir = os.homedir()) {
  const pathImpl = platform === 'win32' ? path.win32 : path.posix

  if (platform === 'win32') {
    const appDataRoot = env.APPDATA || pathImpl.join(homeDir, 'AppData', 'Roaming')
    return pathImpl.join(appDataRoot, FIXED_USER_DATA_APP_NAME)
  }

  if (platform === 'darwin') {
    return pathImpl.join(homeDir, 'Library', 'Application Support', FIXED_USER_DATA_APP_NAME)
  }

  const xdgConfigHome = env.XDG_CONFIG_HOME || pathImpl.join(homeDir, '.config')
  return pathImpl.join(xdgConfigHome, FIXED_USER_DATA_APP_NAME)
}

module.exports = {
  FIXED_USER_DATA_APP_NAME,
  getStableUserDataPath
}
