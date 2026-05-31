/**
 * Feishu IPC Handlers
 * 飞书桥接相关的 IPC 处理器
 */

const { setupImBridgeHandlers } = require('./im-bridge-handlers')

function setupFeishuHandlers(ipcMain, feishuBridge, configManager) {
  if (!feishuBridge) {
    console.warn('[IPC] FeishuBridge not available, skipping handlers')
    return
  }

  setupImBridgeHandlers(ipcMain, feishuBridge, configManager, 'feishu')

  ipcMain.handle('feishu:listTargets', async (_event, payload = {}) => {
    return feishuBridge.listSendableTargets(payload)
  })

  ipcMain.handle('feishu:bindSessionToTarget', async (_event, payload = {}) => {
    return feishuBridge.bindSessionToTarget(payload.sessionId, {
      openId: payload.openId || payload.targetId,
      targetId: payload.targetId,
      displayName: payload.displayName
    })
  })

  ipcMain.handle('feishu:unbindSessionTarget', async (_event, payload = {}) => {
    return feishuBridge.unbindSessionTarget(payload.sessionId)
  })

  ipcMain.handle('feishu:getSessionBinding', async (_event, sessionId) => {
    return feishuBridge.getSessionBinding(sessionId)
  })

}

module.exports = { setupFeishuHandlers }
