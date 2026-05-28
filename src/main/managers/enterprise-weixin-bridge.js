/**
 * 企业微信 Bridge
 *
 * 第一批目标：
 * - 文本消息接入
 * - 历史会话选择闭环
 * - /help /status /sessions /new
 * - 基础流式回复
 * - 桌面端介入文本回传
 *
 * 第二批（后续）：
 * - 入站图片下载解密
 * - 主动发送 target 列表 / toolbar
 * - 图片双向回传
 */

const path = require('path')
const os = require('os')
const fs = require('fs')
const { generateReqId, MessageType } = require('@wecom/aibot-node-sdk')
const { ImFrontendNotifier } = require('./im-frontend-notifier')
const { ImReplyCollector } = require('./im-reply-collector')
const { ImSessionMapper } = require('./im-session-mapper')
const {
  buildHistoryChoiceMenuText,
  buildActiveSessionsText,
  buildStatusText,
  buildCommandHelpText,
} = require('./im-command-presenter')
const { extractImagePaths } = require('./im-utils')

const MAX_TEXT_LENGTH = 6000
const MSG_ID_TTL = 10 * 60 * 1000
const DEFAULT_HISTORY_LIMIT = 5
const HISTORY_CHOICE_TIMEOUT = 10 * 60 * 1000
const ENTERPRISE_WEIXIN_UNSUPPORTED_MESSAGE_TEXT = '暂不支持该类型的企业微信消息，请发送文本或图片消息'

class EnterpriseWeixinBridge {
  constructor(configManager, agentSessionManager, mainWindow) {
    this._configManager = configManager
    this._agentSessionManager = agentSessionManager
    this._mainWindow = mainWindow
    this._imType = 'enterprise-weixin'
    this._configKey = 'enterpriseWeixin'

    this._wsClient = null
    this._connected = false
    this._sessionDatabase = agentSessionManager.sessionDatabase

    this._notifier = new ImFrontendNotifier(mainWindow, this._imType)
    this._replyCollector = new ImReplyCollector({ maxTextLength: MAX_TEXT_LENGTH })
    this._sessionMapper = this._createSessionMapper(this._getConfig())

    this._processedMsgIds = new Map()
    this._msgIdCleanupTimer = null
    this._agentListeners = null
    this._wsListeners = null

    this._processQueues = new Map()
    this._sessionIdentities = new Map()
    this._sessionTargets = new Map()
    this._targetSessionMap = new Map()
    this._pendingInboundMessages = new Map()
    this._activeSendChunks = new Map()

    this._bindAgentEvents()
  }

  _syncSessionDatabase() {
    const db = this._agentSessionManager?.sessionDatabase || null
    this._sessionDatabase = db
    if (this._sessionMapper) {
      this._sessionMapper._sessionDatabase = db
    }
  }

  _getConfig() {
    const config = this._configManager.getConfig()
    return config?.enterpriseWeixin || {}
  }

  _createSessionMapper(cfg = this._getConfig()) {
    return new ImSessionMapper({
      agentSessionManager: this._agentSessionManager,
      sessionDatabase: this._agentSessionManager.sessionDatabase,
      imType: this._imType,
      maxHistorySessions: cfg.maxHistorySessions || DEFAULT_HISTORY_LIMIT,
      defaultCwd: cfg.defaultCwd || null,
      buildIdentityKey: (identity) => {
        const userId = identity.userId || ''
        const channelId = identity.channelId || identity.chatId || identity.userId || ''
        return `${userId}:${channelId}`
      },
      buildSessionTitle: (identity) => `企业微信 · ${identity.nickname || identity.userId || '未命名'}`,
    })
  }

  getStatus() {
    return {
      connected: !!this._connected,
      activeSessions: this._sessionMapper?.sessionMap?.size || 0,
    }
  }

  setMainWindow(win) {
    this._mainWindow = win
    this._notifier.setMainWindow(win)
  }

  async start() {
    this._syncSessionDatabase()
    const config = this._getConfig()
    if (!config.enabled) {
      console.log('[EnterpriseWeixin] Bridge is disabled, skipping start')
      return false
    }

    const { botId, secret } = config
    if (!botId || !secret) {
      console.error('[EnterpriseWeixin] Bot ID or secret not configured')
      return false
    }

    this._sessionMapper = this._createSessionMapper(config)
    this._restoreSessionBindings()

    try {
      await this._connect(botId, secret)
      this._startMsgIdCleanup()
      console.log('[EnterpriseWeixin] Bridge started successfully')
      return true
    } catch (err) {
      console.error('[EnterpriseWeixin] Failed to start:', err.message)
      this._notifier.notifyError({ error: err.message })
      return false
    }
  }

  async stop() {
    this._stopMsgIdCleanup()
    this._unbindWsEvents()
    this._replyCollector.clearAll()
    this._sessionMapper.clearAll()
    this._processQueues.clear()
    this._processedMsgIds.clear()
    this._pendingInboundMessages.clear()
    this._activeSendChunks.clear()

    if (this._wsClient) {
      try { this._wsClient.disconnect() } catch {}
      this._wsClient = null
    }

    this._connected = false
    this._notifier.notifyStatusChange({ connected: false })
    console.log('[EnterpriseWeixin] Bridge stopped')
  }

  async restart() {
    await this.stop()
    return this.start()
  }

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

  async _connect(botId, secret) {
    const { WSClient } = require('@wecom/aibot-node-sdk')
    this._wsClient = new WSClient({ botId, secret })
    this._bindWsEvents()
    await new Promise((resolve, reject) => {
      let settled = false
      const cleanup = () => {
        try { this._wsClient?.off('authenticated', onAuthenticated) } catch {}
        try { this._wsClient?.off('error', onError) } catch {}
      }
      const onAuthenticated = () => {
        if (settled) return
        settled = true
        cleanup()
        resolve(true)
      }
      const onError = (err) => {
        if (settled) return
        settled = true
        cleanup()
        reject(err instanceof Error ? err : new Error(String(err)))
      }

      this._wsClient.on('authenticated', onAuthenticated)
      this._wsClient.on('error', onError)
      try {
        this._wsClient.connect()
      } catch (err) {
        onError(err)
      }
    })
  }

  _bindWsEvents() {
    this._unbindWsEvents()
    if (!this._wsClient) return

    const onMessage = (frame) => {
      this._handleMessage(frame).catch(err => {
        console.error('[EnterpriseWeixin] Message handling error:', err.message)
      })
    }
    const onEvent = (frame) => {
      this._handleEvent(frame).catch(err => {
        console.error('[EnterpriseWeixin] Event handling error:', err.message)
      })
    }
    const onConnected = () => {
      this._connected = true
      this._notifier.notifyStatusChange({ connected: true })
      console.log('[EnterpriseWeixin] WS connected')
    }
    const onDisconnected = (reason) => {
      this._connected = false
      this._notifier.notifyStatusChange({ connected: false })
      console.log('[EnterpriseWeixin] WS disconnected:', reason || '')
    }
    const onError = (err) => {
      console.error('[EnterpriseWeixin] WS error:', err?.message || err)
      this._notifier.notifyError({ error: err?.message || String(err) })
    }

    this._wsClient.on('message', onMessage)
    this._wsClient.on('event', onEvent)
    this._wsClient.on('connected', onConnected)
    this._wsClient.on('authenticated', onConnected)
    this._wsClient.on('disconnected', onDisconnected)
    this._wsClient.on('error', onError)

    this._wsListeners = { onMessage, onEvent, onConnected, onDisconnected, onError }
  }

  _unbindWsEvents() {
    if (!this._wsClient || !this._wsListeners) return
    this._wsClient.off('message', this._wsListeners.onMessage)
    this._wsClient.off('event', this._wsListeners.onEvent)
    this._wsClient.off('connected', this._wsListeners.onConnected)
    this._wsClient.off('authenticated', this._wsListeners.onConnected)
    this._wsClient.off('disconnected', this._wsListeners.onDisconnected)
    this._wsClient.off('error', this._wsListeners.onError)
    this._wsListeners = null
  }

  _bindAgentEvents() {
    const mgr = this._agentSessionManager
    this._agentListeners = {
      userMessage: ({ sessionId, imChannel, content, images, source }) => {
        const hasBinding = this._sessionTargets.has(sessionId)
        if (source !== 'im-inbound' && (imChannel === this._imType || hasBinding)) {
          this._onDesktopIntervention(sessionId, content, images)
        }
      },
      agentMessage: (sessionId, message) => {
        this._onAgentMessage(sessionId, message)
      },
      agentResult: (sessionId) => {
        return this._onAgentResult(sessionId)
      },
      agentError: (sessionId) => {
        this._activeSendChunks.delete(sessionId)
        this._replyCollector.clear(sessionId)
      },
    }
    for (const [event, fn] of Object.entries(this._agentListeners)) {
      mgr.on(event, fn)
    }
  }

  async _handleMessage(frame) {
    this._syncSessionDatabase()
    const message = this._normalizeInboundMessage(frame)
    if (!message?.msgId) return

    if (this._processedMsgIds.has(message.msgId)) return
    this._processedMsgIds.set(message.msgId, Date.now())

    const identity = this._buildIdentity(message)
    const mapKey = this._sessionMapper.buildKey(identity)

    if (message.unsupported) {
      await this._sendTextReply(frame, ENTERPRISE_WEIXIN_UNSUPPORTED_MESSAGE_TEXT)
      return
    }

    const pendingChoice = this._sessionMapper._pendingChoices.get(mapKey)
    if (pendingChoice) {
      const normalizedPendingText = (message.text || '').trim()
      if (normalizedPendingText) {
        await this._handlePendingChoice(frame, message, identity, mapKey)
        return
      }
    }

    const normalizedText = (message.text || '').trim()
    if (normalizedText.startsWith('/')) {
      await this._handleCommand(normalizedText, {
        frame,
        identity,
        chatId: message.chatId,
        chatType: message.chatType,
      })
      return
    }

    const currentSessionId = await this._sessionMapper.resolveActiveSessionId(mapKey)
    const currentSession = currentSessionId ? this._agentSessionManager.sessions.get(currentSessionId) : null
    if (currentSession?.status === 'streaming') {
      await this._sendTextReply(frame, 'AI 正在响应中，请等待完成后再发送下一条消息')
      return
    }

    let ensured = await this._sessionMapper.ensureSession(identity)
    if (ensured?.needsChoice) {
      this._pendingInboundMessages.set(mapKey, { frame, message, identity })
      this._sessionMapper.initPendingChoice(
        mapKey,
        ensured.sessions,
        (menuText) => this._sendTextReply(frame, menuText),
        {
          timeoutMs: HISTORY_CHOICE_TIMEOUT,
          menuBuilder: (sessions) => this._buildHistoryChoiceMenu(sessions),
        }
      ).catch((err) => {
        console.error('[EnterpriseWeixin] initPendingChoice failed:', err?.message || err)
      })
      return
    }

    const sessionId = ensured?.sessionId || null
    if (!sessionId) return

    this._sessionIdentities.set(sessionId, {
      userId: identity.userId,
      senderId: identity.userId,
      senderName: identity.nickname || identity.userId,
      chatId: message.chatId,
      chatType: message.chatType,
      chatName: identity.channelName || identity.nickname || identity.userId,
    })
    this._notifier.notifyMessageReceived({
      sessionId,
      senderNick: identity.nickname || identity.userId,
      text: message.text || (message.images?.length ? '[图片]' : ''),
      images: message.images,
      imagesCount: Array.isArray(message.images) ? message.images.length : 0,
    })
    await this._enqueueInboundMessage(sessionId, frame, message, identity)
  }

  async _handleEvent(frame) {
    const event = frame?.body?.event
    const eventType = event?.eventtype
    if (!eventType) return

    if (eventType === 'enter_chat') {
      await this._handleEnterChat(frame)
      return
    }

    if (eventType === 'disconnected_event') {
      this._connected = false
      this._notifier.notifyStatusChange({ connected: false })
      console.warn('[EnterpriseWeixin] Received disconnected_event from server')
      return
    }

    console.log('[EnterpriseWeixin] Event received:', eventType)
  }

  async _handleEnterChat(frame) {
    const helpText = this._buildHelpText()
    try {
      await this._wsClient.replyWelcome(frame, {
        msgtype: 'text',
        text: {
          content: `您好，我已连接到水利桌面智能体。\n\n${helpText}`,
        },
      })
    } catch (err) {
      console.error('[EnterpriseWeixin] Failed to send welcome message:', err.message)
    }
  }

  _normalizeInboundMessage(frame) {
    const body = frame?.body || {}
    const msgType = body?.msgtype || 'text'
    const base = {
      frame,
      raw: body,
      msgId: body?.msgid || '',
      msgType,
      chatId: body?.chatid || body?.from?.userid || '',
      chatType: body?.chattype || 'single',
      userId: body?.from?.userid || '',
      senderName: body?.from?.name || body?.from?.displayName || body?.from?.userid || '',
      text: '',
      images: [],
      unsupported: false,
    }

    if (msgType === MessageType.Text || msgType === 'text') {
      return {
        ...base,
        text: body?.text?.content || '',
      }
    }

    if (msgType === MessageType.Mixed || msgType === 'mixed') {
      const items = Array.isArray(body?.mixed?.msg_item) ? body.mixed.msg_item : []
      return {
        ...base,
        text: items
          .filter(item => item?.msgtype === 'text')
          .map(item => item?.text?.content || '')
          .join(''),
        unsupported: items.some(item => item?.msgtype === 'image'),
      }
    }

    if (msgType === MessageType.Image || msgType === 'image') {
      return {
        ...base,
        unsupported: true,
      }
    }

    return {
      ...base,
      unsupported: true,
    }
  }

  _buildIdentity(message) {
    const isGroup = String(message.chatType || '').toLowerCase() === 'group'
    return {
      userId: message.userId,
      channelId: isGroup ? (message.chatId || message.userId) : message.userId,
      chatId: message.chatId,
      chatType: message.chatType,
      nickname: message.senderName || message.userId,
      channelName: isGroup ? (message.chatId || '') : '',
    }
  }

  async _handlePendingChoice(frame, message, identity, mapKey) {
    const text = String(message.text || '').trim()
    if (!text) return

    if (text === '/new') {
      await this._handleCommand('/new', { frame, identity, chatId: message.chatId, chatType: message.chatType }, {
        preservePendingSelection: true,
      })
      return
    }

    const result = await this._sessionMapper.handleChoice(mapKey, text, identity)
    if (result?.invalidChoice) {
      await this._sendTextReply(frame, `编号错误：请输入 0-${this._sessionMapper._pendingChoices.get(mapKey)?.sessions?.length || 0} 之间的数字\n\n${result.menuText}`)
      return
    }

    const sessionId = result?.sessionId || null
    if (!sessionId) {
      await this._sendTextReply(frame, '没有可用会话，请重新发送消息')
      return
    }

    this._sessionIdentities.set(sessionId, {
      userId: identity.userId,
      senderId: identity.userId,
      senderName: identity.nickname || identity.userId,
      chatId: identity.chatId,
      chatType: identity.chatType,
      chatName: identity.channelName || identity.nickname || identity.userId,
    })

    if (result.action === 'resume') {
      await this._sendTextReply(frame, result.wasActivated ? '已连接到当前会话' : '已恢复历史会话')
    } else if (result.action === 'new') {
      await this._sendTextReply(frame, this._buildSessionCreatingText())
    }

    const pending = this._pendingInboundMessages.get(mapKey)
    if (pending) {
      this._pendingInboundMessages.delete(mapKey)
      this._notifier.notifyMessageReceived({
        sessionId,
        senderNick: identity.nickname || identity.userId,
        text: pending.message.text || (pending.message.images?.length ? '[图片]' : ''),
        images: pending.message.images,
        imagesCount: Array.isArray(pending.message.images) ? pending.message.images.length : 0,
      })
      await this._enqueueInboundMessage(sessionId, pending.frame, pending.message, identity)
    }
  }

  async _handleCommand(text, context, options = {}) {
    this._syncSessionDatabase()
    const normalizedText = String(text || '').trim()
    const parts = normalizedText.split(/\s+/).filter(Boolean)
    if (parts.length === 0) return

    const cmd = parts[0].toLowerCase()
    const args = parts.slice(1)
    const identity = context.identity
    const chatId = context.chatId || identity.chatId
    const mapKey = this._sessionMapper.buildKey(identity)

    if (!options.preservePendingSelection) {
      this._sessionMapper.clearPendingChoice(mapKey)
      this._pendingInboundMessages.delete(mapKey)
    }

    let sessionId = await this._resolveCommandSessionId(mapKey, identity)
    const currentSession = sessionId ? this._agentSessionManager.sessions.get(sessionId) : null

    switch (cmd) {
      case '/help':
        await this._sendTextReply(context.frame, this._buildHelpText())
        return

      case '/status':
        await this._sendTextReply(context.frame, this._buildStatusMenuText(sessionId))
        return

      case '/sessions':
        await this._sendTextReply(context.frame, this._buildSessionsMenuText(chatId, sessionId))
        return

      case '/new': {
        if (currentSession?.status === 'streaming') {
          await this._sendTextReply(context.frame, 'AI 正在响应中，请等待完成后再操作')
          return
        }
        if (sessionId) {
          this._clearSessionIdentity(sessionId)
        }
        const newId = await this._sessionMapper.createSession(identity)
        if (!newId) {
          await this._sendTextReply(context.frame, '创建新会话失败')
          return
        }
        this._sessionMapper.sessionMap.set(mapKey, newId)
        this._sessionIdentities.set(newId, {
          userId: identity.userId,
          senderId: identity.userId,
          senderName: identity.nickname || identity.userId,
          chatId: identity.chatId,
          chatType: identity.chatType,
          chatName: identity.channelName || identity.nickname || identity.userId,
        })
        this._notifier.notifySessionCreated({ sessionId: newId, nickname: identity.nickname || identity.userId })
        await this._sendTextReply(context.frame, this._buildSessionCreatingText())
        return
      }

      default:
        await this._sendTextReply(context.frame, `未知命令: ${cmd}\n输入 /help 查看可用命令`)
    }
  }

  async _resolveCommandSessionId(mapKey, identity) {
    let sessionId = await this._sessionMapper.resolveActiveSessionId(mapKey)
    if (sessionId) return sessionId

    const targetSessionId = this._targetSessionMap.get(identity.userId)
    if (!targetSessionId) return null
    const valid = await this._sessionMapper._validateSession(targetSessionId)
    if (!valid) {
      this._targetSessionMap.delete(identity.userId)
      return null
    }
    return targetSessionId
  }

  _getActiveSessionsByChat(chatId) {
    const chatKey = String(chatId || '').trim()
    const results = []
    const seen = new Set()
    for (const [sessionId, identity] of this._sessionIdentities.entries()) {
      if (!identity) continue
      if (String(identity.chatId || '').trim() !== chatKey) continue
      const session = this._agentSessionManager.sessions.get(sessionId)
      if (!session || seen.has(sessionId)) continue
      seen.add(sessionId)
      results.push(session)
    }
    return results.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))
  }

  _buildHelpText() {
    return buildCommandHelpText([
      '企业微信可用命令：',
      '/help    - 显示帮助',
      '/status  - 查看连接状态',
      '/sessions - 查看当前聊天下的活跃会话',
      '/new     - 新建会话',
      '',
      '回复数字可选择历史会话，回复 0 开始全新会话',
    ])
  }

  _buildStatusMenuText(sessionId) {
    const currentSession = sessionId ? this._agentSessionManager.sessions.get(sessionId) : null
    const activeSessions = Array.from(this._agentSessionManager.sessions.values())
      .filter(session => session?.imChannel === this._imType)
    return buildStatusText({
      bridgeLabel: '企业微信',
      connected: this._connected,
      activeSessions,
      currentSession,
      getProfileName: (profileId) => this._getProfileName(profileId),
    })
  }

  _buildSessionsMenuText(chatId, currentSessionId) {
    const activeSessions = this._getActiveSessionsByChat(chatId)
    return buildActiveSessionsText({
      activeSessions,
      currentSessionId,
      getDirName: (cwd) => this._getDirName(cwd),
      getProfileName: (profileId) => this._getProfileName(profileId),
    })
  }

  _buildHistoryChoiceMenu(sessions) {
    return buildHistoryChoiceMenuText({
      sessions,
      maxSessions: this._getConfig().maxHistorySessions || DEFAULT_HISTORY_LIMIT,
      getDirName: (cwd) => this._getDirName(cwd),
      getProfileName: (profileId) => this._getProfileName(profileId),
      isSessionActivated: (sessionId) => !!this._agentSessionManager.sessions.get(sessionId)?.queryGenerator,
    })
  }

  _buildSessionCreatingText() {
    return '正在创建新会话，请继续发送消息'
  }

  _getDirName(cwd) {
    if (!cwd) return '-'
    try {
      return path.basename(cwd) || cwd
    } catch {
      return cwd
    }
  }

  _getProfileName(profileId) {
    if (!profileId) return '默认配置'
    try {
      return this._configManager.getAPIProfile?.(profileId)?.name || profileId
    } catch {
      return profileId
    }
  }

  async _sendTextReply(frame, content) {
    if (!this._wsClient || !frame?.headers?.req_id) return
    await this._wsClient.reply(frame, {
      msgtype: 'text',
      text: { content: String(content || '') },
    })
  }

  _enqueueInboundMessage(sessionId, frame, message, identity) {
    const prev = this._processQueues.get(sessionId) || Promise.resolve()
    const next = prev.then(() => this._processOneMessage(sessionId, frame, message, identity)).catch(err => {
      console.error(`[EnterpriseWeixin] Process error for session ${sessionId}:`, err.message)
    })
    this._processQueues.set(sessionId, next)
    return next
  }

  async _processOneMessage(sessionId, frame, message, identity) {
    const text = typeof message.text === 'string' ? message.text : ''
    const images = Array.isArray(message.images) ? message.images : []
    if (!text.trim() && images.length === 0) return

    const senderNick = identity.nickname || identity.userId
    const userMessage = images.length > 0 && !text.trim()
      ? { text: '', images }
      : (images.length > 0 ? { text, images } : text)

    this._replyCollector.startCollect(sessionId, {
      webhook: frame,
      sendFn: async (_sid, chunk) => {
        if (!chunk) return
        await this._sendStreamChunk(sessionId, frame, chunk)
      },
    })

    await this._agentSessionManager.appendExternalUserMessage(sessionId, {
      content: text || '[图片]',
      source: this._imType,
      senderNick,
      meta: {
        msgId: message.msgId,
        identity,
        enterpriseWeixinChatId: message.chatId,
      },
    })

    const donePromise = new Promise((resolve) => {
      const originalDone = this._replyCollector.onAgentResult.bind(this._replyCollector)
      this._replyCollector.onAgentResult = async (sid) => {
        const result = await originalDone(sid)
        if (sid === sessionId) resolve(result)
        return result
      }
    })

    try {
      await this._agentSessionManager.sendMessage(sessionId, userMessage, {
        meta: {
          source: 'im-inbound',
          senderNick,
          enterpriseWeixinChatId: message.chatId,
        },
      })
      await donePromise
    } catch (err) {
      this._replyCollector.clear(sessionId)
      console.error('[EnterpriseWeixin] Process message error:', err)
      try {
        await this._sendTextReply(frame, `处理消息时出错: ${err.message}`)
      } catch {}
    }
  }

  async _sendStreamChunk(sessionId, frame, message) {
    if (!this._wsClient || !frame?.headers?.req_id) return
    const text = this._extractTextContent(message)
    if (!text) return

    let sendChunk = this._activeSendChunks.get(sessionId)
    if (!sendChunk) {
      const streamId = generateReqId('wecom_stream')
      sendChunk = async (chunk, finish = false) => {
        return this._wsClient.replyStreamNonBlocking(frame, streamId, chunk, finish)
      }
      this._activeSendChunks.set(sessionId, sendChunk)
    }

    try {
      await sendChunk(text, false)
    } catch (err) {
      console.error('[EnterpriseWeixin] Stream write error:', err.message)
    }
  }

  _extractTextContent(message) {
    if (!message?.content) return ''
    if (typeof message.content === 'string') return message.content
    if (Array.isArray(message.content)) {
      return message.content
        .filter(block => block?.type === 'text')
        .map(block => block?.text || '')
        .join('')
    }
    return ''
  }

  _onAgentMessage(sessionId, message) {
    const collector = this._replyCollector._collectors?.get(sessionId)
    if (!collector?.webhook) return
    this._sendStreamChunk(sessionId, collector.webhook, message)
    for (const imagePath of extractImagePaths(message)) {
      this._replyCollector.addImagePath(sessionId, imagePath)
    }
  }

  async _onAgentResult(sessionId) {
    const collector = this._replyCollector._collectors?.get(sessionId)
    const frame = collector?.webhook || null
    const sendChunk = this._activeSendChunks.get(sessionId)
    if (sendChunk) {
      try {
        await sendChunk('', true)
      } catch (err) {
        console.error('[EnterpriseWeixin] Stream finish error:', err.message)
      }
      this._activeSendChunks.delete(sessionId)
    }

    const result = await this._replyCollector.onAgentResult(sessionId)
    if (!frame || !this._wsClient) return result

    if (result?.imagePaths?.length > 0) {
      console.log('[EnterpriseWeixin] Image reply is deferred to phase 2:', result.imagePaths.length)
    }

    return result
  }

  _onDesktopIntervention(sessionId, content, images) {
    const identity = this._sessionIdentities.get(sessionId)
    if (!identity) return

    const chatId = identity.chatType === 'group' ? identity.chatId : identity.senderId
    if (!chatId || !this._wsClient || !this._connected) return

    this._replyCollector.recordDesktopIntervention(
      sessionId,
      { content, images },
      async (_sid, { userContent, fullText }) => {
        if (!fullText) return
        const block = `桌面介入> ${userContent}\n\n${fullText}`
        await this._wsClient.sendMessage(chatId, {
          msgtype: 'markdown',
          markdown: { content: block },
        })
      }
    )
  }

  async sendTextToTarget({ sessionId, userId, targetId, displayName, text } = {}) {
    this._syncSessionDatabase()
    const content = typeof text === 'string' ? text.trim() : ''
    if (!content) throw new Error('发送内容不能为空')

    const resolvedUserId = typeof (userId || targetId) === 'string' ? (userId || targetId).trim() : ''
    if (!resolvedUserId) throw new Error('userId 不能为空')
    if (!this._wsClient || !this._connected) throw new Error('企业微信未连接')

    if (sessionId) {
      this._agentSessionManager.assertSessionImBindingAllowed(sessionId, this._imType)
      this._assertSessionTargetAllowed(sessionId, resolvedUserId, displayName)
    }

    await this._wsClient.sendMessage(resolvedUserId, {
      msgtype: 'markdown',
      markdown: { content },
    })

    if (sessionId) {
      this.bindSessionToTarget(sessionId, { userId: resolvedUserId, displayName })
    }

    return { success: true, targetId: resolvedUserId }
  }

  bindSessionToTarget(sessionId, { userId, targetId, displayName } = {}) {
    this._syncSessionDatabase()
    const resolvedUserId = typeof (userId || targetId) === 'string' ? (userId || targetId).trim() : ''
    if (!sessionId || !resolvedUserId) {
      throw new Error('sessionId 和 userId 不能为空')
    }

    const session = this._agentSessionManager.sessions.get(sessionId)
      || this._sessionDatabase?.getAgentConversation?.(sessionId)
    if (!session) {
      throw new Error(`Session ${sessionId} 不存在或已关闭`)
    }

    this._agentSessionManager.assertSessionImBindingAllowed(sessionId, this._imType)
    this._assertSessionTargetAllowed(sessionId, resolvedUserId, displayName)
    this._agentSessionManager.bindSessionExternalImSource(sessionId, this._imType)

    const previousTarget = this._sessionTargets.get(sessionId)
    if (previousTarget?.userId && previousTarget.userId !== resolvedUserId) {
      this._targetSessionMap.delete(previousTarget.userId)
    }

    const previousSessionId = this._targetSessionMap.get(resolvedUserId)
    if (previousSessionId && previousSessionId !== sessionId) {
      this._sessionTargets.delete(previousSessionId)
      this._targetSessionMap.delete(resolvedUserId)
    }

    const target = {
      userId: resolvedUserId,
      displayName: displayName || previousTarget?.displayName || resolvedUserId,
    }
    this._sessionTargets.set(sessionId, target)
    this._targetSessionMap.set(resolvedUserId, sessionId)
    this._sessionIdentities.set(sessionId, {
      userId: resolvedUserId,
      senderId: resolvedUserId,
      senderName: target.displayName || resolvedUserId,
      chatId: resolvedUserId,
      chatType: 'single',
      chatName: target.displayName || resolvedUserId,
    })

    if (this._sessionDatabase?.updateDingTalkMetadata) {
      try {
        this._sessionDatabase.updateDingTalkMetadata(sessionId, resolvedUserId, resolvedUserId)
      } catch (err) {
        console.warn('[EnterpriseWeixin] Failed to persist bound target identity:', err.message)
      }
    }

    return { success: true, target }
  }

  _assertSessionTargetAllowed(sessionId, resolvedUserId, displayName) {
    if (!sessionId || !resolvedUserId) return

    const existingTarget = this._sessionTargets.get(sessionId)
    const identity = this._sessionIdentities.get(sessionId)
    const row = this._sessionDatabase?.getAgentConversation?.(sessionId)
    const rowUserId = typeof row?.staff_id === 'string' ? row.staff_id.trim() : ''
    const existingUserId = existingTarget?.userId || identity?.senderId || rowUserId

    if (existingUserId && existingUserId !== resolvedUserId) {
      const currentLabel = existingTarget?.displayName || identity?.senderName || existingUserId
      const nextLabel = displayName || resolvedUserId
      throw new Error(`当前会话已绑定企业微信联系人「${currentLabel}」，不能再发送给「${nextLabel}」。请新建会话后再联系其他成员。`)
    }
  }

  getSessionBinding(sessionId) {
    this._syncSessionDatabase()
    const target = this._sessionTargets.get(sessionId) || null
    if (!target) {
      const row = this._sessionDatabase?.getAgentConversation?.(sessionId)
      const userId = typeof row?.staff_id === 'string' ? row.staff_id.trim() : ''
      if (!userId || row?.im_channel !== this._imType) return null
      return {
        targetId: userId,
        userId,
        displayName: userId,
      }
    }
    return {
      targetId: target.userId,
      userId: target.userId,
      displayName: target.displayName,
    }
  }

  unbindSessionTarget(sessionId) {
    if (!sessionId) return { success: false, error: 'sessionId 不能为空' }
    const target = this._sessionTargets.get(sessionId) || null
    if (target?.userId) {
      this._targetSessionMap.delete(target.userId)
    }
    this._sessionTargets.delete(sessionId)
    return { success: true }
  }

  listSendableTargets() {
    const results = []
    const seen = new Set()

    for (const [sessionId, target] of this._sessionTargets.entries()) {
      if (!target?.userId || seen.has(target.userId)) continue
      seen.add(target.userId)
      results.push({
        id: target.userId,
        userId: target.userId,
        displayName: target.displayName || target.userId,
        name: target.displayName || target.userId,
        hasContextToken: true,
        sessionId,
      })
    }

    return results
  }

  _restoreSessionBindings() {
    this._syncSessionDatabase()
    if (!this._sessionDatabase?.getAgentConversation) return

    for (const [sessionId, session] of this._agentSessionManager.sessions.entries()) {
      const row = this._sessionDatabase.getAgentConversation(sessionId)
      const userId = typeof row?.staff_id === 'string' ? row.staff_id.trim() : ''
      if (!userId || row?.im_channel !== this._imType) continue

      this._sessionTargets.set(sessionId, {
        userId,
        displayName: userId,
      })
      this._targetSessionMap.set(userId, sessionId)
      if (!this._sessionIdentities.has(sessionId)) {
        this._sessionIdentities.set(sessionId, {
          userId,
          senderId: userId,
          senderName: userId,
          chatId: typeof row?.conversation_id === 'string' && row.conversation_id.trim() ? row.conversation_id.trim() : userId,
          chatType: row?.conversation_id && row.conversation_id !== userId ? 'group' : 'single',
          chatName: userId,
        })
      }
      if (session && !session.imChannel) {
        session.imChannel = this._imType
      }
    }
  }

  _clearSessionIdentity(sessionId) {
    this._activeSendChunks.delete(sessionId)
    const identity = this._sessionIdentities.get(sessionId)
    if (!identity) return
    if (identity.chatType === 'single' && !this._sessionTargets.has(sessionId)) {
      this._sessionIdentities.delete(sessionId)
    }
  }

  _startMsgIdCleanup() {
    this._stopMsgIdCleanup()
    this._msgIdCleanupTimer = setInterval(() => {
      const cutoff = Date.now() - MSG_ID_TTL
      for (const [id, ts] of this._processedMsgIds.entries()) {
        if (ts < cutoff) this._processedMsgIds.delete(id)
      }
    }, 60 * 1000)
  }

  _stopMsgIdCleanup() {
    if (this._msgIdCleanupTimer) {
      clearInterval(this._msgIdCleanupTimer)
      this._msgIdCleanupTimer = null
    }
  }
}

module.exports = { EnterpriseWeixinBridge }
