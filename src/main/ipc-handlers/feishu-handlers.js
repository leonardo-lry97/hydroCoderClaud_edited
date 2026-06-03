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

  ipcMain.handle('feishu:bindTarget', async (_event, payload = {}) => {
    return feishuBridge.bindTarget(payload.sessionId, {
      targetId: payload.targetId || payload.openId,
      targetType: payload.targetType || 'user',
      displayName: payload.displayName
    })
  })

  ipcMain.handle('feishu:unbindTarget', async (_event, payload = {}) => {
    return feishuBridge.unbindTarget(payload.sessionId)
  })

  ipcMain.handle('feishu:getBinding', async (_event, sessionId) => {
    return feishuBridge.getBinding(sessionId)
  })

}

module.exports = { setupFeishuHandlers }
