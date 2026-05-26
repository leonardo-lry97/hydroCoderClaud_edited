/**
 * 企业微信 IPC 处理器
 */

const { setupImBridgeHandlers } = require('./im-bridge-handlers')

function setupEnterpriseWeixinHandlers(ipcMain, bridge, configManager) {
  if (!bridge) return

  // 注册标准 IM Bridge 处理器：getStatus / start / stop / restart / updateConfig / sendText
  setupImBridgeHandlers(ipcMain, bridge, configManager, 'enterprise-weixin')
}

module.exports = { setupEnterpriseWeixinHandlers }
