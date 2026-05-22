/**
 * 飞书桥接
 *
 * 将飞书事件订阅（接收）和消息 API（发送）连接到 Agent 会话系统。
 * 使用共享的 ImSessionMapper、ImReplyCollector、ImFrontendNotifier helper。
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const { ImSessionMapper } = require('./im-session-mapper')
const { ImReplyCollector } = require('./im-reply-collector')
const { ImFrontendNotifier } = require('./im-frontend-notifier')
const { FeishuEventClient } = require('./feishu-event-client')
const { FeishuMessageAPI } = require('./feishu-message-api')

// 图片相关常量（与钉钉保持一致）
const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|bmp)$/i
const IMAGE_MAX_SIZE = 20 * 1024 * 1024 // 20MB

class FeishuBridge {
  constructor(configManager, agentSessionManager, mainWindow) {
    this._config = configManager
    this._agentSessionManager = agentSessionManager
    this._mainWindow = mainWindow
    this._sessionDatabase = agentSessionManager.sessionDatabase

    this._api = new FeishuMessageAPI()
    this._eventClient = new FeishuEventClient()

    this._notifier = new ImFrontendNotifier(mainWindow, 'feishu')
    this._replyCollector = new ImReplyCollector({ maxTextLength: 6000 })
    this._sessionMapper = new ImSessionMapper({
      agentSessionManager,
      sessionDatabase: this._sessionDatabase,
      imType: 'feishu',
      maxHistorySessions: 5,
      buildIdentityKey: (identity) => `${identity.userId}:${identity.chatId}`,
      buildSessionTitle: (identity) => {
        const chatName = identity.chatName || identity.chatId?.substring(0, 8) || ''
        const nickname = identity.nickname || identity.userId?.substring(0, 8) || ''
        return `飞书 · ${chatName} · ${nickname}`
      },
    })

    /** @type {Map<string, Promise>} 串行消息队列 */
    this._processQueues = new Map()
    /** @type {Map<string, number>} 去重 */
    this._processedMsgIds = new Map()
    /** @type {Map<string, { message: object, senderId: string, chatId: string, chatType: string }>} */
    this._pendingMessages = new Map()
    /** @type {Map<string, { senderId: string, chatId: string, chatType: string }>} 每个 session 的飞书身份（用于桌面端介入路由和图片发送） */
    this._sessionIdentities = new Map()

    this._agentListeners = null
    this._eventListeners = null

    this._bindAgentEvents()
  }

  // ─── 生命周期 ───

  get config() {
    try { return this._config.getConfig()?.feishu || {} } catch { return {} }
  }

  async start() {
    const cfg = this.config
    if (!cfg.enabled || !cfg.appId || !cfg.appSecret) {
      console.log('[FeishuBridge] Not enabled or missing credentials')
      return
    }

    this._sessionMapper = new ImSessionMapper({
      agentSessionManager: this._agentSessionManager,
      sessionDatabase: this._sessionDatabase,
      imType: 'feishu',
      maxHistorySessions: cfg.maxHistorySessions || 5,
      defaultCwd: cfg.defaultCwd || null,
      buildIdentityKey: (identity) => `${identity.userId}:${identity.chatId}`,
      buildSessionTitle: (identity) => {
        const chatName = identity.chatName || identity.chatId?.substring(0, 8) || ''
        const nickname = identity.nickname || identity.userId?.substring(0, 8) || ''
        return `飞书 · ${chatName} · ${nickname}`
      },
    })

    this._api.setCredentials(cfg.appId, cfg.appSecret)
    this._bindEventClientEvents()
    await this._eventClient.connect(cfg.appId, cfg.appSecret)
  }

  async stop() {
    this._eventClient.stop()
    this._unbindEventClientEvents()
    this._replyCollector.clearAll()
    this._sessionMapper.clearAll()
    this._processQueues.clear()
    this._processedMsgIds.clear()
    this._sessionIdentities.clear()
  }

  async restart() { await this.stop(); await this.start() }

  destroy() {
    this.stop()
    if (this._agentListeners) {
      const mgr = this._agentSessionManager
      for (const [event, fn] of Object.entries(this._agentListeners)) {
        mgr.off(event, fn)
      }
      this._agentListeners = null
    }
  }

  getStatus() {
    return {
      connected: this._eventClient.connected,
      activeSessions: this._sessionMapper.sessionMap.size,
    }
  }

  setMainWindow(win) {
    this._mainWindow = win
    this._notifier.setMainWindow(win)
  }

  // ─── 事件客户端事件 ───

  _bindEventClientEvents() {
    this._unbindEventClientEvents()
    const onMessage = (event) => this._handleFeishuMessage(event)
    const onCardAction = (event) => this._handleCardAction(event)
    const onStatus = (data) => this._notifier.notifyStatusChange(data)
    const onError = (data) => this._notifier.notifyError(data)
    this._eventClient.on('message', onMessage)
    this._eventClient.on('cardAction', onCardAction)
    this._eventClient.on('statusChange', onStatus)
    this._eventClient.on('error', onError)
    this._eventListeners = { onMessage, onCardAction, onStatus, onError }
  }

  _unbindEventClientEvents() {
    if (!this._eventListeners) return
    const ec = this._eventClient
    ec.off('message', this._eventListeners.onMessage)
    ec.off('cardAction', this._eventListeners.onCardAction)
    ec.off('statusChange', this._eventListeners.onStatus)
    ec.off('error', this._eventListeners.onError)
    this._eventListeners = null
  }

  // ─── Agent 事件 ───

  _bindAgentEvents() {
    const mgr = this._agentSessionManager
    this._agentListeners = {
      userMessage: ({ sessionId, sessionType, content, images, source }) => {
        if (source !== 'feishu' && sessionType === 'feishu') {
          this._onDesktopIntervention(sessionId, content, images)
        }
      },
      agentMessage: (sessionId, message) => { this._onAgentMessage(sessionId, message) },
      agentResult: (sessionId) => { this._onAgentResult(sessionId) },
      agentError: (sessionId, error) => { this._onAgentError(sessionId, error) },
    }
    for (const [event, fn] of Object.entries(this._agentListeners)) {
      mgr.on(event, fn)
    }
  }

  // ─── 消息处理 ───

  async _handleFeishuMessage(event) {
    const { msgId, senderId, chatId, chatType, text, images } = event

    if (this._processedMsgIds.has(msgId)) return
    this._processedMsgIds.set(msgId, Date.now())
    this._cleanupOldMsgIds()

    if (text && text.startsWith('/')) {
      this._handleCommand(text, { senderId, chatId, chatType }).catch(() => {})
      return
    }

    // 历史会话选择
    const mapKey = this._sessionMapper.buildKey({ userId: senderId, chatId })
    if (text && /^\d+$/.test(text.trim())) {
      const pendingChoice = this._sessionMapper._pendingChoices?.get(mapKey)
      if (pendingChoice) {
        this._handleChoiceReply(mapKey, text, { userId: senderId, chatId, chatType }, senderId, chatId, chatType)
        return
      }
    }

    // 下载图片（从 imageKey 获取 base64）
    let downloadedImages = undefined
    if (images && images.length > 0) {
      downloadedImages = []
      for (const img of images) {
        try {
          if (img.imageKey) {
            const downloaded = await this._api.downloadImage(img.imageKey, img.messageId || msgId)
            downloadedImages.push(downloaded)
          } else if (img.base64) {
            downloadedImages.push(img)
          }
        } catch (err) {
          console.error('[FeishuBridge] Image download failed:', err.message)
        }
      }
      downloadedImages = downloadedImages.length > 0 ? downloadedImages : undefined
    }

    const message = { text, images: downloadedImages }

    const sessionId = await this._ensureSession({
      userId: senderId, chatId, chatType,
    }, message, senderId, chatId, chatType)

    if (!sessionId) return

    // 存储飞书身份（用于桌面端介入和图片发送）
    this._sessionIdentities.set(sessionId, { senderId, chatId, chatType })

    this._notifier.notifyMessageReceived({
      sessionId, text,
      senderNick: senderId,
      images: downloadedImages,
    })

    this._enqueueMessage(sessionId, message, senderId, chatId, chatType)
  }

  async _handleChoiceReply(mapKey, inputText, identity, senderId, chatId, chatType) {
    const result = await this._sessionMapper.handleChoice(mapKey, inputText, identity)
    const receiveId = chatType === 'p2p' ? senderId : chatId
    const receiveIdType = chatType === 'p2p' ? 'open_id' : 'chat_id'

    if (result.sessionId) {
      this._sessionIdentities.set(result.sessionId, { senderId, chatId, chatType })
      await this._api.sendTextMessage(receiveIdType, receiveId, '已恢复会话')
      this._notifier.notifySessionCreated({ sessionId: result.sessionId, nickname: senderId })
      const pending = this._pendingMessages.get(mapKey)
      if (pending) {
        this._pendingMessages.delete(mapKey)
        this._enqueueMessage(result.sessionId, pending.message, pending.senderId, pending.chatId, pending.chatType)
      }
    } else {
      await this._api.sendTextMessage(receiveIdType, receiveId, '无效选择，请重新回复数字')
    }
  }

  async _handleCardAction(event) {
    const { actionType, actionValue, userId, chatId } = event
    console.log('[FeishuBridge] Card action:', actionType, JSON.stringify(actionValue))
    const commandText = this._resolveCardCommand(actionType, actionValue)
    if (!commandText) return
    await this._handleCommand(commandText, {
      senderId: userId,
      chatId,
      chatType: 'p2p',
    })
  }

  async _handleCommand(text, context) {
    const parts = text.trim().split(/\s+/)
    const cmd = parts[0].toLowerCase()
    const args = parts.slice(1)

    const mapKey = this._sessionMapper.buildKey({ userId: context.senderId, chatId: context.chatId })
    this._sessionMapper.clearPendingChoice(mapKey)
    this._pendingMessages.delete(mapKey)

    let sessionId = await this._sessionMapper.resolveActiveSessionId(mapKey)
    const identity = this._sessionIdentities.get(sessionId) || context
    const receiveId = identity.chatType === 'p2p' ? identity.senderId : identity.chatId
    const receiveIdType = identity.chatType === 'p2p' ? 'open_id' : 'chat_id'

    switch (cmd) {
      case '/help':
        await this._api.sendTextMessage(receiveIdType, receiveId, this._getHelpText())
        break
      case '/status': {
        const s = this.getStatus()
        const currentSession = sessionId ? this._agentSessionManager.sessions.get(sessionId) : null
        const currentTitle = currentSession?.title || '无'
        await this._api.sendTextMessage(receiveIdType, receiveId,
          `连接状态: ${s.connected ? '已连接' : '未连接'}\n活跃会话: ${s.activeSessions} 个\n当前会话: ${currentTitle}`)
        break
      }
      case '/sessions':
        await this._api.sendTextMessage(receiveIdType, receiveId, this._buildActiveSessionsText({ sessionId, chatId: context.chatId }))
        break
      case '/close': {
        const targetSessionId = await this._resolveCloseTargetSessionId(args, { chatId: context.chatId, mapKey })
        if (!targetSessionId) {
          await this._api.sendTextMessage(receiveIdType, receiveId, args.length > 0
            ? `编号错误：请输入 1-${this._getActiveSessionsByChat(context.chatId).length} 之间的数字`
            : '当前没有连接会话，无需关闭')
          break
        }
        const targetSession = this._agentSessionManager.sessions.get(targetSessionId)
        if (targetSession?.status === 'streaming') {
          await this._api.sendTextMessage(receiveIdType, receiveId, 'AI 正在响应中，请等待完成后再关闭')
          break
        }
        await this._agentSessionManager.close(targetSessionId)
        this._clearSessionIdentity(targetSessionId)
        this._notifier.notifySessionClosed({ sessionId: targetSessionId })
        sessionId = await this._sessionMapper.resolveActiveSessionId(mapKey)
        await this._api.sendTextMessage(receiveIdType, receiveId, args.length > 0
          ? `会话已关闭\n\n${this._buildActiveSessionsText({ sessionId, chatId: context.chatId })}`
          : `会话已关闭\n\n${this._buildActiveSessionsText({ sessionId, chatId: context.chatId })}`)
        break
      }
      case '/new': {
        const currentSession = sessionId ? this._agentSessionManager.sessions.get(sessionId) : null
        if (currentSession?.status === 'streaming') {
          await this._api.sendTextMessage(receiveIdType, receiveId, 'AI 正在响应中，请等待完成后再操作')
          break
        }
        if (sessionId) {
          this._clearSessionIdentity(sessionId)
        }
        const newId = await this._sessionMapper.createSession({
          userId: context.senderId, chatId: context.chatId,
          chatType: context.chatType, nickname: context.senderId,
        })
        if (newId) {
          this._sessionMapper.sessionMap.set(mapKey, newId)
          this._sessionIdentities.set(newId, { senderId: context.senderId, chatId: context.chatId, chatType: context.chatType })
          this._notifier.notifySessionCreated({ sessionId: newId, nickname: context.senderId })
        }
        await this._api.sendTextMessage(receiveIdType, receiveId, newId ? '已创建新会话' : '创建新会话失败')
        break
      }
      case '/resume': {
        const currentSession = sessionId ? this._agentSessionManager.sessions.get(sessionId) : null
        if (currentSession?.status === 'streaming') {
          await this._api.sendTextMessage(receiveIdType, receiveId, 'AI 正在响应中，请等待完成后再操作')
          break
        }
        const history = await this._sessionMapper._queryHistorySessions({
          userId: context.senderId,
          chatId: context.chatId,
          chatType: context.chatType,
        })
        if (!history || history.length === 0) {
          await this._api.sendTextMessage(receiveIdType, receiveId, '没有历史会话记录\n\n发送任意消息可开始新会话')
          break
        }
        const selectedIndex = Number.parseInt(args[0], 10)
        if (!Number.isNaN(selectedIndex)) {
          if (selectedIndex < 1 || selectedIndex > history.length) {
            await this._api.sendTextMessage(receiveIdType, receiveId, `编号错误：请输入 1-${history.length} 之间的数字`)
            break
          }
          const selected = history[selectedIndex - 1]
          const restoredSessionId = selected?.session_id || selected?.sessionId || selected?.id || null
          let resolvedSessionId = restoredSessionId
          if (resolvedSessionId) {
            try {
              await this._agentSessionManager.reopen(resolvedSessionId)
              this._sessionMapper.sessionMap.set(mapKey, resolvedSessionId)
            } catch (err) {
              console.error('[FeishuBridge] Resume session failed:', err)
              resolvedSessionId = null
            }
          }
          if (resolvedSessionId) {
            this._sessionIdentities.set(resolvedSessionId, {
              senderId: context.senderId,
              chatId: context.chatId,
              chatType: context.chatType,
            })
            this._notifier.notifySessionCreated({ sessionId: resolvedSessionId, nickname: context.senderId })
            await this._api.sendTextMessage(receiveIdType, receiveId, '已恢复会话')
          } else {
            await this._api.sendTextMessage(receiveIdType, receiveId, '恢复会话失败')
          }
          break
        }
        await this._sessionMapper.initPendingChoice(mapKey, history, async (menuText) => {
          await this._api.sendTextMessage(receiveIdType, receiveId, menuText)
        })
        break
      }
      case '/rename': {
        if (!sessionId) {
          await this._api.sendTextMessage(receiveIdType, receiveId, '当前没有活跃会话，无法重命名')
          break
        }
        const newTitle = args.join(' ').trim()
        if (!newTitle) {
          await this._api.sendTextMessage(receiveIdType, receiveId, '请提供新名称，例如：/rename 我的项目')
          break
        }
        this._agentSessionManager.rename(sessionId, newTitle)
        await this._api.sendTextMessage(receiveIdType, receiveId, `会话已重命名为：${newTitle}`)
        break
      }
      default:
        await this._api.sendTextMessage(receiveIdType, receiveId, `未知命令: ${cmd}\n输入 /help 查看可用命令`)
    }
  }

  // ─── 会话管理 ───

  async _ensureSession(identity, message, senderId, chatId, chatType) {
    const mapKey = this._sessionMapper.buildKey(identity)
    const result = await this._sessionMapper.ensureSession(identity)

    if (result.needsChoice) {
      this._pendingMessages.set(mapKey, { message, senderId, chatId, chatType })
      await this._sessionMapper.initPendingChoice(mapKey, result.sessions, async (menuText) => {
        await this._api.sendTextMessage(
          chatType === 'p2p' ? 'open_id' : 'chat_id',
          chatType === 'p2p' ? senderId : chatId, menuText)
      })
      return null
    }

    if (result.sessionId) {
      this._notifier.notifySessionCreated({
        sessionId: result.sessionId,
        nickname: identity.nickname || identity.userId?.substring(0, 8),
      })
    }
    return result.sessionId
  }

  // ─── 消息队列 ───

  _enqueueMessage(sessionId, message, senderId, chatId, chatType) {
    const prev = this._processQueues.get(sessionId) || Promise.resolve()
    const task = prev.catch(() => {}).then(() => this._processOneMessage(sessionId, message, senderId, chatId, chatType))
    this._processQueues.set(sessionId, task)
    task.finally(() => {
      if (this._processQueues.get(sessionId) === task) this._processQueues.delete(sessionId)
    })
  }

  async _processOneMessage(sessionId, message, senderId, chatId, chatType) {
    const identity = this._sessionIdentities.get(sessionId) || { senderId, chatId, chatType }
    const receiveId = identity.chatType === 'p2p' ? identity.senderId : identity.chatId
    const receiveIdType = identity.chatType === 'p2p' ? 'open_id' : 'chat_id'

    const { donePromise, sendChunk } = this._replyCollector.startCollect(sessionId, {
      sendFn: async (text) => {
        try { await this._api.sendTextMessage(receiveIdType, receiveId, text) } catch (err) {
          console.error('[FeishuBridge] sendTextMessage error:', err)
        }
      },
    })

    try {
      await this._agentSessionManager.sendMessage(sessionId, message, {
        meta: { source: 'feishu', senderNick: senderId, feishuChatId: chatId },
      })
      await donePromise
    } catch (err) {
      console.error('[FeishuBridge] Process message error:', err)
      try {
        await this._api.sendTextMessage(receiveIdType, receiveId, `处理消息时出错: ${err.message}`)
      } catch {}
    }
  }

  // ─── 桌面端介入 ───

  _onDesktopIntervention(sessionId, content, images) {
    const mapKey = this._resolveMapKeyForSession(sessionId)
    if (!mapKey) return

    const identity = this._sessionIdentities.get(sessionId)
    if (!identity) return

    const receiveId = identity.chatType === 'p2p' ? identity.senderId : identity.chatId
    const receiveIdType = identity.chatType === 'p2p' ? 'open_id' : 'chat_id'

    this._replyCollector.recordDesktopIntervention(
      sessionId, { content, images },
      async (sid, { userContent, fullText }) => {
        if (!fullText) return
        const block = `> ${userContent}\n\n${fullText}`
        await this._api.sendTextMessage(receiveIdType, receiveId, block)
      }
    )
  }

  _resolveMapKeyForSession(sessionId) {
    for (const [key, sid] of this._sessionMapper.sessionMap) {
      if (sid === sessionId) return key
    }
    return null
  }

  // ─── Agent 事件处理 ───

  _onAgentMessage(sessionId, message) {
    // 流式文本 → replyCollector 实时推
    this._replyCollector.onAgentMessage(sessionId, message, async (text) => {})

    // 从 tool_use 块中提取图片路径（Agent 操作了图片文件）
    if (message && typeof message === 'object') {
      const paths = this._extractImagePaths(message)
      for (const imagePath of paths) {
        this._replyCollector.addImagePath(sessionId, imagePath)
      }
    }
  }

  async _onAgentResult(sessionId) {
    // 1. 处理回复收集（是否有桌面端介入待发送）
    await this._replyCollector.onAgentResult(sessionId, async (sid, data) => {
      const identity = this._sessionIdentities.get(sid)
      if (!identity) return
      const receiveId = identity.chatType === 'p2p' ? identity.senderId : identity.chatId
      const receiveIdType = identity.chatType === 'p2p' ? 'open_id' : 'chat_id'
      const block = `> ${data.userContent}\n\n${data.fullText}`
      await this._api.sendTextMessage(receiveIdType, receiveId, block)
      if (Array.isArray(data.userImages) && data.userImages.length > 0) {
        await this._sendBase64Images(receiveIdType, receiveId, data.userImages)
      }
    })

    // 2. 发送 Agent 收集到的图片
    const imagePaths = this._replyCollector.getImagePaths(sessionId)
    if (imagePaths.length > 0) {
      const identity = this._sessionIdentities.get(sessionId)
      if (identity) {
        const receiveId = identity.chatType === 'p2p' ? identity.senderId : identity.chatId
        const receiveIdType = identity.chatType === 'p2p' ? 'open_id' : 'chat_id'
        for (const imagePath of imagePaths) {
          try {
            const stat = await fs.promises.stat(imagePath).catch(() => null)
            if (!stat || stat.size === 0 || stat.size > IMAGE_MAX_SIZE) continue
            const imageKey = await this._api.uploadImage(imagePath)
            await this._api.sendImageMessage(receiveIdType, receiveId, imageKey)
          } catch (err) {
            console.error('[FeishuBridge] Image send failed:', imagePath, err.message)
          }
        }
      }
    }

    // 3. 发送桌面端介入的 base64 图片
  }

  async _onAgentError(sessionId, error) {
    await this._replyCollector.onAgentError(sessionId, error)
  }

  // ─── 图片路径提取 ───

  /**
   * 从 Agent 消息的 tool_use 块中递归提取磁盘图片路径
   * 与钉钉 _extractImagePaths 相同逻辑
   */
  _extractImagePaths(obj, depth = 0) {
    if (depth > 10) return []
    if (!obj || typeof obj !== 'object') return []

    const paths = []
    for (const value of Object.values(obj)) {
      if (typeof value === 'string') {
        if (IMAGE_EXTENSIONS.test(value) && (value.startsWith('/') || /^[A-Z]:[/\\]/.test(value))) {
          paths.push(this._normalizePath(value))
        }
      } else if (typeof value === 'object' && value !== null) {
        paths.push(...this._extractImagePaths(value, depth + 1))
      }
    }
    return paths
  }

  _normalizePath(rawPath) {
    // MSYS /c/... → C:/...
    const m = rawPath.match(/^\/([a-zA-Z])\/(.*)$/)
    if (m) return `${m[1].toUpperCase()}:/${m[2]}`
    return rawPath
  }

  // ─── 辅助 ───

  _getHelpText() {
    return [
      '飞书 Agent 桥接命令:',
      '/help    - 显示帮助',
      '/status  - 查看连接状态',
      '/sessions - 查看当前聊天下的活跃会话',
      '/close [编号] - 关闭当前会话或指定会话',
      '/new     - 创建新会话',
      '/resume [编号] - 恢复历史会话',
      '/rename <名称> - 重命名当前会话',
    ].join('\n')
  }

  _getActiveSessionsByChat(chatId) {
    const sessions = [...this._agentSessionManager.sessions.values()]
    return sessions.filter((session) => {
      if (session.type !== 'feishu' || !session.queryGenerator) return false
      const identity = this._sessionIdentities.get(session.id)
      if (identity?.chatId) return identity.chatId === chatId
      const row = this._sessionDatabase?.getAgentConversation?.(session.id)
      return row?.conversation_id === chatId
    })
  }

  _buildActiveSessionsText({ sessionId, chatId }) {
    const activeSessions = this._getActiveSessionsByChat(chatId)
    if (activeSessions.length === 0) return '暂无活跃会话'

    const lines = ['活跃会话：', '']
    activeSessions.forEach((session, index) => {
      const marker = session.id === sessionId ? '✅ ' : ''
      const dir = session.cwd ? this._basename(session.cwd) : '-'
      lines.push(`${index + 1}. ${marker}${session.title || session.id.substring(0, 8)} (${dir})`)
    })
    return lines.join('\n')
  }

  async _resolveCloseTargetSessionId(args, { chatId, mapKey }) {
    if (!args.length) return this._sessionMapper.resolveActiveSessionId(mapKey)
    const index = Number.parseInt(args[0], 10)
    const activeSessions = this._getActiveSessionsByChat(chatId)
    if (Number.isNaN(index) || index < 1 || index > activeSessions.length) return null
    return activeSessions[index - 1]?.id || null
  }

  _clearSessionIdentity(sessionId) {
    for (const [key, sid] of this._sessionMapper.sessionMap.entries()) {
      if (sid === sessionId) {
        this._sessionMapper.clearSessionState(key)
      }
    }
    this._sessionIdentities.delete(sessionId)
  }

  async _sendBase64Images(receiveIdType, receiveId, images) {
    for (const image of images) {
      try {
        if (!image?.base64) continue
        const filePath = await this._writeTempBase64Image(image)
        if (!filePath) continue
        try {
          const imageKey = await this._api.uploadImage(filePath)
          await this._api.sendImageMessage(receiveIdType, receiveId, imageKey)
        } finally {
          await fs.promises.unlink(filePath).catch(() => {})
        }
      } catch (err) {
        console.error('[FeishuBridge] Base64 image send failed:', err.message)
      }
    }
  }

  async _writeTempBase64Image(image) {
    const ext = this._mediaTypeToExt(image.mediaType)
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'feishu-'))
    const filePath = path.join(dir, `input-${Date.now()}.${ext}`)
    await fs.promises.writeFile(filePath, Buffer.from(image.base64, 'base64'))
    return filePath
  }

  _mediaTypeToExt(mediaType) {
    switch (mediaType) {
      case 'image/png': return 'png'
      case 'image/gif': return 'gif'
      case 'image/webp': return 'webp'
      case 'image/bmp': return 'bmp'
      default: return 'jpg'
    }
  }

  _basename(rawPath) {
    return path.basename(rawPath)
  }

  _resolveCardCommand(actionType, actionValue) {
    const value = actionValue && typeof actionValue === 'object' ? actionValue : {}
    const rawCommand = typeof value.command === 'string'
      ? value.command.trim()
      : typeof value.cmd === 'string'
        ? value.cmd.trim()
        : ''
    if (rawCommand) {
      return rawCommand.startsWith('/') ? rawCommand : `/${rawCommand}`
    }

    switch (actionType) {
      case 'button':
      case 'select_static':
      case 'overflow': {
        const intent = typeof value.intent === 'string' ? value.intent.trim().toLowerCase() : ''
        const index = value.index ?? value.sessionIndex ?? value.choice
        const title = typeof value.title === 'string' ? value.title.trim() : ''
        if (intent === 'resume' && index != null) return `/resume ${index}`
        if (intent === 'close' && index != null) return `/close ${index}`
        if (intent === 'rename' && title) return `/rename ${title}`
        if (intent === 'new') return '/new'
        if (intent === 'sessions') return '/sessions'
        if (intent === 'status') return '/status'
        if (intent === 'help') return '/help'
        break
      }
      default:
        break
    }
    return null
  }

  _cleanupOldMsgIds() {
    const now = Date.now()
    for (const [msgId, ts] of this._processedMsgIds) {
      if (now - ts > 10 * 60 * 1000) this._processedMsgIds.delete(msgId)
    }
  }
}

module.exports = { FeishuBridge }
