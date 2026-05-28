/**
 * IM Bridge 共享 IPC 处理器
 *
 * 为任何 IM Bridge 注册标准 IPC 通道，消除各 handler 文件中的重复代码。
 * 各 Bridge 的 handler 文件只需调用 setupImBridgeHandlers 即可获得：
 *   getStatus / start / stop / restart / updateConfig / sendText
 *
 * 如有平台特有通道，在调用 setupImBridgeHandlers 之后单独注册。
 *
 * 用法：
 *   const { setupImBridgeHandlers } = require('./im-bridge-handlers')
 *   setupImBridgeHandlers(ipcMain, bridge, configManager)
 */

/**
 * 注册标准 IM Bridge IPC 处理器
 * @param {import('electron').IpcMain} ipcMain
 * @param {object} bridge - BaseImBridge 兼容的桥接实例
 * @param {object} configManager - 配置管理器
 * @param {string} prefix - IPC 通道前缀（如 'dingtalk'、'feishu'）
 */
function setupImBridgeHandlers(ipcMain, bridge, configManager, prefix) {
  if (!bridge || !prefix) return

  // 状态查询
  ipcMain.handle(`${prefix}:getStatus`, async () => {
    return bridge.getStatus()
  })

  // 启动
  ipcMain.handle(`${prefix}:start`, async () => {
    return bridge.start()
  })

  // 停止
  ipcMain.handle(`${prefix}:stop`, async () => {
    return bridge.stop()
  })

  // 重启
  ipcMain.handle(`${prefix}:restart`, async () => {
    return bridge.restart()
  })

  // 更新配置并重启
  ipcMain.handle(`${prefix}:updateConfig`, async (_event, config) => {
    const current = configManager.getConfig()
    const configKey = _resolveConfigKey(bridge, prefix)
    current[configKey] = { ...current[configKey], ...config }
    await configManager.save(current)
    if (current[configKey]?.enabled) {
      return bridge.restart()
    }
    await bridge.stop()
    return false
  })

  // 主动发送文本
  ipcMain.handle(`${prefix}:sendText`, async (_event, payload = {}) => {
    return bridge.sendTextToTarget(payload)
  })
}

/** @private */
function _resolveConfigKey(bridge, prefix) {
  // 尝试从 bridge 实例获取 _configKey 属性
  if (bridge._configKey) return bridge._configKey
  // 否则用前缀映射
  const keyMap = {
    dingtalk: 'dingtalk',
    feishu: 'feishu',
    weixin: 'weixin',
    'enterprise-weixin': 'enterpriseWeixin',
  }
  return keyMap[prefix] || prefix
}

module.exports = { setupImBridgeHandlers }
