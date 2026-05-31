/**
 * DingTalk IPC Handlers
 * 钉钉桥接相关的 IPC 处理器
 */

const { setupImBridgeHandlers } = require('./im-bridge-handlers')

function setupDingTalkHandlers(ipcMain, dingtalkBridge, configManager) {
  if (!dingtalkBridge) {
    console.warn('[IPC] DingTalkBridge not available, skipping handlers')
    return
  }

  setupImBridgeHandlers(ipcMain, dingtalkBridge, configManager, 'dingtalk')

  ipcMain.handle('dingtalk:listTargets', async () => {
    return dingtalkBridge.listTargets()
  })

  ipcMain.handle('dingtalk:bindSessionToTarget', async (_event, payload = {}) => {
    return dingtalkBridge.bindSessionToTarget(payload.sessionId, {
      staffId: payload.staffId,
      targetId: payload.targetId,
      displayName: payload.displayName
    })
  })

  ipcMain.handle('dingtalk:getSessionBinding', async (_event, sessionId) => {
    return dingtalkBridge.getSessionBinding(sessionId)
  })

}

module.exports = { setupDingTalkHandlers }
