const { app, BrowserWindow } = require('electron')

function restoreOrCreateMainWindow({
  trayController,
  getMainWindow,
  BrowserWindowClass = BrowserWindow,
  createWindow,
  resetCleanupState,
  restartPowerSaveBlocker,
  rebindMainWindowReferences,
  logger = console
} = {}) {
  const mainWindow = typeof getMainWindow === 'function' ? getMainWindow() : null
  if (mainWindow && !mainWindow.isDestroyed()) {
    logger.log?.('[Main] Existing instance detected, restoring main window')
    trayController?.showMainWindow?.()
    return 'show-existing-window'
  }

  const windows = BrowserWindowClass.getAllWindows()
  if (windows.length !== 0) {
    logger.log?.('[Main] Existing instance detected, focusing existing secondary window')
    const fallbackWindow = windows[0]
    if (fallbackWindow && !fallbackWindow.isDestroyed?.()) {
      if (fallbackWindow.isMinimized?.()) {
        fallbackWindow.restore?.()
      }
      fallbackWindow.show?.()
      fallbackWindow.focus?.()
    }
    return 'show-existing-secondary-window'
  }

  logger.log?.('[Main] Existing instance detected, recreating main window')
  resetCleanupState?.()
  trayController?.resetQuitting?.()
  createWindow?.()
  trayController?.refreshTrayMenu?.()
  restartPowerSaveBlocker?.()
  rebindMainWindowReferences?.({
    notifyAgentSessionsClosed: true,
    restartDingtalk: true
  })
  return 'create-new-window'
}

function setupSingleInstanceLock({
  appInstance = app,
  onSecondInstance,
  logger = console
} = {}) {
  const gotLock = appInstance.requestSingleInstanceLock()
  if (!gotLock) {
    logger.log?.('[Main] Another instance is already running, exiting current process')
    appInstance.quit()
    return false
  }

  appInstance.on('second-instance', (event, commandLine, workingDirectory) => {
    logger.log?.('[Main] Second instance launch detected')
    onSecondInstance?.({ event, commandLine, workingDirectory })
  })

  return true
}

module.exports = {
  restoreOrCreateMainWindow,
  setupSingleInstanceLock
}
