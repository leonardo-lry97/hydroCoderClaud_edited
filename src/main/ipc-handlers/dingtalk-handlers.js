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

  ipcMain.handle('dingtalk:bindTarget', async (_event, payload = {}) => {
    return dingtalkBridge.bindTarget(payload.sessionId, {
      targetId: payload.targetId || payload.staffId,
      targetType: payload.targetType || 'user',
      displayName: payload.displayName
    })
  })

  ipcMain.handle('dingtalk:unbindTarget', async (_event, payload = {}) => {
    return dingtalkBridge.unbindTarget(payload.sessionId)
  })

  ipcMain.handle('dingtalk:getBinding', async (_event, sessionId) => {
    return dingtalkBridge.getBinding(sessionId)
  })

}

module.exports = { setupDingTalkHandlers }
