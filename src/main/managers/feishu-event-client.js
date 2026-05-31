/**
 * 飞书 WebSocket 事件订阅客户端
 *
 * 封装 @larksuiteoapi/node-sdk 的 WSClient 和 EventDispatcher，
 * 通过飞书"事件订阅长连接模式"接收用户消息和卡片交互事件。
 *
 * SDK WSClient 负责：连接、心跳、重连、protobuf 二进制协议解码
 * 本类负责：EventEmitter 事件转发、消息结构化
 */

const { EventEmitter } = require('events')
const { WSClient, EventDispatcher, Domain } = require('@larksuiteoapi/node-sdk')
const { MAX_RECONNECT_ATTEMPTS, getReconnectDelayMs } = require('./im-reconnect-policy')

const FEISHU_SOCKET_LIVENESS_TIMEOUT_MS = 30000
const FEISHU_SOCKET_LIVENESS_CHECK_MS = 5000
const FEISHU_HANDSHAKE_TIMEOUT_MS = 5000

class FeishuEventClient extends EventEmitter {
  constructor(opts = {}) {
    super()
    this._appId = null
    this._appSecret = null
    this._connected = false
    this._stopped = false
    this._wsClient = null
    this._eventDispatcher = null
    this._reconnectWatchdog = null
    this._reconnectAttempt = 0
    this._watchdogSocket = null
    this._socketLivenessTimer = null
    this._lastSocketActivityAt = 0
  }

  // ─── 公开 API ───

  get connected() { return this._connected }

  /**
   * 连接飞书事件订阅
   * @param {string} appId
   * @param {string} appSecret
   */
  async connect(appId, appSecret) {
    this._appId = appId
    this._appSecret = appSecret
    this._stopped = false
    this._reconnectAttempt = 0

    await this._startClient()
  }

  /** 停止连接 */
  stop(reason = 'manual') {
    this._stopped = true
    this._connected = false
    if (reason !== 'watchdog') {
      this._reconnectAttempt = 0
    }
    this._clearReconnectWatchdog()
    this._clearSocketLivenessMonitor()
    this._closeClient()
    this._eventDispatcher = null
  }

  async _startClient() {
    console.log(`[FeishuEventClient] _startClient begin, reconnectAttempt=${this._reconnectAttempt}, connected=${this._connected}, stopped=${this._stopped}`)
    this._eventDispatcher = new EventDispatcher({
      loggerLevel: 'info',
    })

    this._eventDispatcher.register({
      'im.message.receive_v1': (data) => {
        this._handleImMessage(data)
      },
      'card.action.trigger': (data) => {
        this._handleCardAction(data)
      },
    })

    try {
      await this._startWsClientWithHandshake()
      console.log('[FeishuEventClient] WSClient started')
    } catch (err) {
      console.error('[FeishuEventClient] Start failed:', err.message)
      this.emit('error', { message: `Start failed: ${err.message}` })
      this._markDisconnected()
      this._closeClient()
      throw err
    }
  }

  _startWsClientWithHandshake() {
    return new Promise((resolve, reject) => {
      let settled = false
      const settle = (fn, value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        fn(value)
      }

      console.log(`[FeishuEventClient] Handshake start, reconnectAttempt=${this._reconnectAttempt}`)
      const timer = setTimeout(() => {
        console.warn(`[FeishuEventClient] Handshake timeout after ${FEISHU_HANDSHAKE_TIMEOUT_MS}ms, reconnectAttempt=${this._reconnectAttempt}`)
        try { this._wsClient?.close({ force: true }) } catch {}
        settle(reject, new Error(`WebSocket handshake did not complete within ${FEISHU_HANDSHAKE_TIMEOUT_MS}ms`))
      }, FEISHU_HANDSHAKE_TIMEOUT_MS)

      this._wsClient = new WSClient({
        appId: this._appId,
        appSecret: this._appSecret,
        domain: Domain.Feishu,
        autoReconnect: true,
        wsConfig: {
          pingTimeout: 35,
        },
        onReady: () => {
          this._connected = true
          this._reconnectAttempt = 0
          this._clearReconnectWatchdog()
          this.emit('statusChange', { connected: true })
          console.log(`[FeishuEventClient] Connected and ready, reconnectAttempt reset to 0`)
          this._hookSocketEvents()
          settle(resolve)
        },
        onError: (err) => {
          console.error(`[FeishuEventClient] Error: ${err.message}, connected=${this._connected}, reconnectAttempt=${this._reconnectAttempt}`)
          this.emit('error', { message: err.message })
          if (!this._connected) {
            console.warn(`[FeishuEventClient] Handshake rejected by onError, reconnectAttempt=${this._reconnectAttempt}`)
            settle(reject, err)
          }
        },
        onReconnecting: () => {
          console.log(`[FeishuEventClient] Reconnecting..., reconnectAttempt=${this._reconnectAttempt}`)
          this._markDisconnected()
          this._startReconnectWatchdog()
        },
        onReconnected: () => {
          this._connected = true
          this._reconnectAttempt = 0
          this._clearReconnectWatchdog()
          this.emit('statusChange', { connected: true })
          console.log('[FeishuEventClient] Reconnected, reconnectAttempt reset to 0')
          this._hookSocketEvents()
        },
      })

      this._wsClient.start({ eventDispatcher: this._eventDispatcher })
    })
  }

  _closeClient() {
    this._watchdogSocket = null
    this._lastSocketActivityAt = 0
    if (this._wsClient) {
      try {
        this._wsClient.close({ force: true })
      } catch {}
      this._wsClient = null
    }
  }

  _markDisconnected() {
    if (this._connected) {
      this._connected = false
      this.emit('statusChange', { connected: false })
    } else {
      this._connected = false
    }
  }

  _hookSocketEvents() {
    const socket = this._wsClient?.wsConfig?.getWSInstance?.()
    if (!socket || socket === this._watchdogSocket) return
    this._watchdogSocket = socket
    this._lastSocketActivityAt = Date.now()
    console.log('[FeishuEventClient] Hooked socket events for current ws instance')
    this._startSocketLivenessMonitor()

    const markAlive = () => {
      this._lastSocketActivityAt = Date.now()
    }

    socket.on('message', markAlive)
    socket.on('pong', markAlive)
    socket.on('ping', markAlive)

    socket.once('close', () => {
      socket.off('message', markAlive)
      socket.off('pong', markAlive)
      socket.off('ping', markAlive)
      if (this._stopped) {
        this._watchdogSocket = null
        this._clearSocketLivenessMonitor()
        return
      }
      console.warn('[FeishuEventClient] Socket closed while active, starting reconnect watchdog')
      this._watchdogSocket = null
      this._clearSocketLivenessMonitor()
      this._markDisconnected()
      this._startReconnectWatchdog()
    })
  }

  _startSocketLivenessMonitor() {
    if (this._socketLivenessTimer) return
    console.log(`[FeishuEventClient] Socket liveness monitor started, timeout=${FEISHU_SOCKET_LIVENESS_TIMEOUT_MS}ms`)
    this._socketLivenessTimer = setInterval(() => {
      if (this._stopped || !this._watchdogSocket) return
      const idleMs = Date.now() - this._lastSocketActivityAt
      if (idleMs < FEISHU_SOCKET_LIVENESS_TIMEOUT_MS) return
      console.warn(`[FeishuEventClient] No inbound socket activity for ${idleMs}ms, terminating socket`)
      try {
        this._watchdogSocket.terminate()
      } catch {}
    }, FEISHU_SOCKET_LIVENESS_CHECK_MS)
  }

  _startReconnectWatchdog() {
    if (this._stopped || this._reconnectWatchdog) return
    const delayMs = getReconnectDelayMs(Math.max(1, this._reconnectAttempt + 1))
    console.log(`[FeishuEventClient] Reconnect watchdog scheduled in ${delayMs}ms, nextAttempt=${this._reconnectAttempt + 1}`)
    this._reconnectWatchdog = setTimeout(() => {
      this._reconnectWatchdog = null
      if (this._stopped || this._connected) return

      const socket = this._wsClient?.wsConfig?.getWSInstance?.()
      if (socket && socket.readyState === 1) {
        this._connected = true
        this._reconnectAttempt = 0
        console.log('[FeishuEventClient] Reconnect watchdog observed live socket, restoring connected state')
        this.emit('statusChange', { connected: true })
        this._hookSocketEvents()
        return
      }

      console.warn(`[FeishuEventClient] Reconnect watchdog escalating to full restart, reconnectAttempt=${this._reconnectAttempt}`)
      this._watchdogRestart()
    }, delayMs)
  }

  async _watchdogRestart() {
    if (this._stopped || this._connected) return
    this._reconnectAttempt += 1
    console.warn(`[FeishuEventClient] Watchdog restart attempt ${this._reconnectAttempt}/${MAX_RECONNECT_ATTEMPTS}`)
    if (this._reconnectAttempt > MAX_RECONNECT_ATTEMPTS) {
      console.error('[FeishuEventClient] Watchdog reconnect exhausted, emitting terminal error')
      this.emit('error', { message: `WebSocket reconnect exhausted after ${MAX_RECONNECT_ATTEMPTS} attempts` })
      return
    }

    try {
      this._closeClient()
      await this._startClient()
      console.log(`[FeishuEventClient] Watchdog restart attempt ${this._reconnectAttempt} succeeded`)
    } catch (err) {
      console.error(`[FeishuEventClient] Watchdog restart attempt ${this._reconnectAttempt} failed: ${err.message}`)
      if (this._stopped || this._connected) return
      if (this._reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
        console.error('[FeishuEventClient] Watchdog reconnect exhausted after failed restart, emitting terminal error')
        this.emit('error', { message: `WebSocket reconnect exhausted after ${MAX_RECONNECT_ATTEMPTS} attempts` })
        return
      }
      this._startReconnectWatchdog()
    }
  }

  _clearReconnectWatchdog() {
    if (this._reconnectWatchdog) {
      clearTimeout(this._reconnectWatchdog)
      this._reconnectWatchdog = null
    }
  }

  _clearSocketLivenessMonitor() {
    if (this._socketLivenessTimer) {
      clearInterval(this._socketLivenessTimer)
      this._socketLivenessTimer = null
    }
  }

  // ─── 事件处理 ───

  /** @private */
  _handleImMessage(data) {
    try {
      // SDK EventDispatcher 传回的是扁平结构：
      // { schema, event_id, event_type, message: { message_id, message_type, chat_id, chat_type, content }, sender: { sender_id: { open_id, ... } } }
      const msg = data?.message || {}
      const sender = data?.sender || {}
      const senderId = sender?.sender_id?.open_id || sender?.sender_id?.user_id
      const senderName = sender?.sender_name || sender?.name || sender?.display_name || null
      const chatName = data?.chat?.name || data?.chat_name || msg?.chat_name || null

      console.log('[FeishuEventClient] event_type:', data?.event_type, 'message_type:', msg.message_type)

      const parsed = {
        msgId: msg.message_id,
        msgType: msg.message_type,
        chatId: msg.chat_id,
        chatType: msg.chat_type,
        senderId,
        senderName,
        chatName,
        mentions: this._extractMentions(msg),
        text: this._extractText(msg),
        images: this._extractImages(msg, msg.message_id),
        unsupported: this._isUnsupportedMessageType(msg),
        content: msg.content,
        raw: data,
      }

      console.log('[FeishuEventClient] Emitting message')
      this.emit('message', parsed)
    } catch (err) {
      console.error('[FeishuEventClient] Handle IM message error:', err)
    }
  }

  /** @private */
  _handleCardAction(data) {
    try {
      const event = data?.event || data
      const action = event?.action || {}
      const context = event?.context || {}
      const operatorId = event?.operator?.operator_id || event?.operator_id || {}
      const userId = operatorId?.open_id || operatorId?.user_id || event?.open_id || event?.user_id || null
      const chatId = context?.open_chat_id || context?.chat_id || context?.chat?.chat_id || null
      const chatType = context?.chat_type || (chatId ? 'chat' : 'p2p')
      console.log('[FeishuEventClient] Card action parsed:', JSON.stringify({
        actionTag: action.tag,
        chatType,
        hasContext: !!context,
      }))
      this.emit('cardAction', {
        actionType: action.tag,
        actionValue: action.value,
        userId,
        chatId,
        chatType,
        messageId: context?.open_message_id || null,
        raw: event,
      })
    } catch (err) {
      console.error('[FeishuEventClient] Handle card action error:', err)
    }
  }

  // ─── 内容提取 ───

  _extractText(msg) {
    const msgType = msg.message_type || msg.msg_type
    if (msgType === 'text') {
      try {
        const parsed = JSON.parse(msg.content)
        return parsed?.text || ''
      } catch {
        return msg.content || ''
      }
    }
    if (msgType === 'post') {
      try {
        const parsed = JSON.parse(msg.content || '{}')
        const parts = []
        for (const elem of this._collectPostElements(parsed)) {
          if (!elem || typeof elem !== 'object') continue
          if (elem.tag === 'text' && elem.text) {
            parts.push(elem.text)
          } else if (elem.tag === 'a' && elem.text) {
            parts.push(elem.text)
          }
        }
        return parts.join('')
      } catch {
        return ''
      }
    }
    return ''
  }

  _extractMentions(msg) {
    const mentions = []
    const seen = new Set()
    try {
      const parsed = typeof msg.content === 'string'
        ? JSON.parse(msg.content || '{}')
        : (msg.content || {})

      const addMention = (mention) => {
        if (!mention || typeof mention !== 'object') return
        const normalizedId = mention.id && typeof mention.id === 'object'
          ? (mention.id.open_id || mention.id.user_id || mention.id.union_id || null)
          : (mention.id || mention.open_id || mention.user_id || mention.user_open_id || mention.app_id || null)
        const normalizedIdType = mention.id_type
          || mention.idType
          || mention.mention_type
          || (mention.id && typeof mention.id === 'object'
            ? (mention.id.open_id ? 'open_id' : (mention.id.user_id ? 'user_id' : null))
            : null)
        const normalized = {
          key: mention.key || mention.mention_key || mention.user_id || mention.open_id || mention.user_open_id || null,
          name: mention.name || mention.display_name || mention.user_name || mention.text || null,
          id: normalizedId,
          idType: normalizedIdType,
        }
        const signature = `${normalized.key || ''}|${normalized.id || ''}|${normalized.name || ''}`
        if (seen.has(signature)) return
        seen.add(signature)
        mentions.push(normalized)
      }

      if (Array.isArray(msg?.mentions)) {
        for (const mention of msg.mentions) {
          addMention(mention)
        }
      }

      if (Array.isArray(parsed?.mentions)) {
        for (const mention of parsed.mentions) {
          addMention(mention)
        }
      }

      if ((msg.message_type || msg.msg_type) === 'post') {
        for (const elem of this._collectPostElements(parsed)) {
          if (elem?.tag !== 'at') continue
          addMention({
            key: elem?.user_id || elem?.open_id || elem?.user_open_id || null,
            name: elem?.user_name || elem?.name || elem?.text || null,
            id: elem?.user_id || elem?.open_id || elem?.user_open_id || null,
            id_type: elem?.user_id ? 'user_id' : (elem?.open_id || elem?.user_open_id ? 'open_id' : null),
          })
        }
      }
    } catch {}
    return mentions
  }

  _extractImages(msg, messageId) {
    const images = []
    const msgType = msg.message_type || msg.msg_type
    try {
      if (msgType === 'image') {
        const parsed = typeof msg.content === 'string'
          ? JSON.parse(msg.content || '{}')
          : (msg.content || {})
        const imageKey = msg.image_key || parsed?.image_key || parsed?.file_key || null
        if (imageKey) {
          images.push({ imageKey, messageId })
        }
      } else if (msgType === 'post') {
        const parsed = JSON.parse(msg.content || '{}')
        for (const elem of this._collectPostElements(parsed)) {
          if (elem?.tag === 'img' && elem?.image_key) {
            images.push({ imageKey: elem.image_key, messageId })
          }
        }
      }
    } catch {}
    return images
  }

  _collectPostElements(parsed) {
    const result = []
    const visit = (value) => {
      if (!value) return
      if (Array.isArray(value)) {
        for (const item of value) visit(item)
        return
      }
      if (typeof value !== 'object') return
      if (typeof value.tag === 'string') {
        result.push(value)
        return
      }
      for (const key of Object.keys(value)) {
        visit(value[key])
      }
    }

    visit(parsed?.content || parsed)
    return result
  }

  _isUnsupportedMessageType(msg) {
    const msgType = msg?.message_type || msg?.msg_type
    return !['text', 'post', 'image'].includes(msgType)
  }
}

module.exports = { FeishuEventClient }
