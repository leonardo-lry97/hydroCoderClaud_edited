import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const { AgentSessionManager } = await import('../../src/main/agent-session-manager.js')
const { EnterpriseWeixinBridge } = await import('../../src/main/managers/enterprise-weixin-bridge.js')

describe('EnterpriseWeixinBridge', () => {
  let tempDir

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hydro-enterprise-weixin-bridge-'))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  function createHarness() {
    const sent = []
    const replies = []
    const wsClient = {
      on: vi.fn(),
      off: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
      downloadFile: vi.fn(async () => ({ buffer: Buffer.from('image-bytes'), filename: 'remote.png' })),
      uploadMedia: vi.fn(async (_buffer, _options) => ({ media_id: `media-${Math.random().toString(36).slice(2, 8)}` })),
      replyMedia: vi.fn(async () => ({ ok: true })),
      sendMediaMessage: vi.fn(async () => ({ ok: true })),
      reply: vi.fn(async (_frame, body) => {
        replies.push(body)
        return { ok: true }
      }),
      replyWelcome: vi.fn(async (_frame, body) => {
        replies.push(body)
        return { ok: true }
      }),
      replyStreamNonBlocking: vi.fn(async () => ({ ok: true })),
      sendMessage: vi.fn(async (_chatId, body) => {
        sent.push(body)
        return { ok: true }
      }),
    }

    const mainWindow = {
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => false,
        send: (channel, data) => sent.push({ channel, data }),
      },
    }
    const configManager = {
      getConfig: () => ({
        settings: { agent: { outputBaseDir: tempDir } },
        enterpriseWeixin: {
          enabled: true,
          botId: 'bot-id',
          secret: 'bot-secret',
          maxHistorySessions: 5,
        },
      }),
      getDefaultProfile: () => ({ id: 'p1', name: '默认配置', baseUrl: 'https://example.com' }),
      getAPIProfile: () => null,
    }
    const manager = new AgentSessionManager(mainWindow, configManager)
    manager.sessionDatabase = {
      insertAgentMessage: vi.fn(),
      createAgentConversation: vi.fn(() => ({ id: 1 })),
      updateAgentConversation: vi.fn(),
      updateAgentMessageToolOutput: vi.fn(),
      updateDingTalkMetadata: vi.fn(),
      getAgentConversation: vi.fn(() => null),
      getImSessionsByType: vi.fn(() => []),
      listAllAgentConversations: vi.fn(() => []),
    }

    const bridge = new EnterpriseWeixinBridge(configManager, manager, mainWindow)
    bridge._wsClient = wsClient
    bridge._connected = true
    return { bridge, manager, sent, replies, wsClient }
  }

  function inboundFrame(overrides = {}) {
    return {
      headers: { req_id: `req-${Math.random().toString(36).slice(2, 8)}` },
      body: {
        msgid: `msg-${Math.random().toString(36).slice(2, 8)}`,
        msgtype: 'text',
        chattype: 'single',
        from: { userid: 'user-a', name: '雷斯林' },
        text: { content: '收到请回复' },
        ...overrides,
      },
    }
  }

  function stubSendMessage(manager) {
    return vi.spyOn(manager, 'sendMessage').mockImplementation(async (sessionId, userMessage, options = {}) => {
      const meta = options.meta || {}
      const session = manager.sessions.get(sessionId)
      const text = typeof userMessage === 'string' ? userMessage : (userMessage?.text || '[图片]')
      const message = {
        id: `msg-ext-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        role: 'user',
        content: text,
        timestamp: Date.now(),
        source: meta.source,
        senderNick: meta.senderNick,
        meta,
      }
      if (userMessage?.images?.length) message.images = userMessage.images
      session.messages.push(message)
      manager.emit('userMessage', {
        sessionId,
        sessionType: session.type,
        imChannel: session.imChannel,
        content: text,
        images: userMessage?.images || null,
        source: meta.source || null,
      })
      manager.emit('agentResult', sessionId)
    })
  }

  it('creates an Enterprise Weixin session and submits inbound text to Agent', async () => {
    const { bridge, manager, sent } = createHarness()
    const sendMessage = stubSendMessage(manager)

    await bridge._handleMessage(inboundFrame())

    expect(sendMessage).toHaveBeenCalledWith(
      expect.any(String),
      '收到请回复',
      {
        meta: expect.objectContaining({
          source: 'im-inbound',
          senderNick: '雷斯林',
          enterpriseWeixinChatId: 'user-a',
        }),
      }
    )
    expect(manager.sessions.size).toBe(1)

    const session = Array.from(manager.sessions.values())[0]
    expect(session.type).toBe('chat')
    expect(session.imChannel).toBe('enterprise-weixin')
    expect(session.title).toBe('企业微信 · 雷斯林')
    expect(sent.map(item => item.channel)).toContain('enterprise-weixin:messageReceived')
  })

  it('does not reconnect when bridge is already connected', async () => {
    const { bridge } = createHarness()
    const connectSpy = vi.spyOn(bridge, '_connect').mockResolvedValue(true)

    bridge._connected = true
    bridge._wsClient = { disconnect: vi.fn() }

    const result = await bridge.start()

    expect(result).toBe(true)
    expect(connectSpy).not.toHaveBeenCalled()
  })

  it('shows help text for /help', async () => {
    const { bridge, replies } = createHarness()

    await bridge._handleMessage(inboundFrame({
      text: { content: '/help' },
    }))

    expect(replies.at(-1)).toMatchObject({
      msgtype: 'markdown',
      markdown: {
        content: expect.stringContaining('/help'),
      },
    })
  })

  it('reports enterprise weixin status with /status', async () => {
    const { bridge, manager, replies } = createHarness()
    const session = manager.create({ type: 'chat', source: 'manual', title: '企业微信测试会话' })
    session.imChannel = 'enterprise-weixin'
    bridge._sessionMapper.sessionMap.set('user-a:user-a', session.id)
    bridge._sessionIdentities.set(session.id, {
      userId: 'user-a',
      senderId: 'user-a',
      senderName: '雷斯林',
      chatId: 'user-a',
      chatType: 'single',
      chatName: '雷斯林',
    })

    await bridge._handleMessage(inboundFrame({
      text: { content: '/status' },
    }))

    expect(replies.at(-1).markdown.content).toContain('企业微信: 已连接')
  })

  it('lists active chat sessions for /sessions', async () => {
    const { bridge, manager, replies } = createHarness()
    const first = manager.create({ type: 'chat', source: 'manual', title: '会话 A' })
    const second = manager.create({ type: 'chat', source: 'manual', title: '会话 B' })
    first.imChannel = 'enterprise-weixin'
    second.imChannel = 'enterprise-weixin'
    bridge._sessionMapper.sessionMap.set('user-a:user-a', first.id)
    bridge._sessionIdentities.set(first.id, {
      userId: 'user-a',
      senderId: 'user-a',
      senderName: '雷斯林',
      chatId: 'user-a',
      chatType: 'single',
      chatName: '雷斯林',
    })
    bridge._sessionIdentities.set(second.id, {
      userId: 'user-a',
      senderId: 'user-a',
      senderName: '雷斯林',
      chatId: 'user-a',
      chatType: 'single',
      chatName: '雷斯林',
    })

    await bridge._handleMessage(inboundFrame({
      text: { content: '/sessions' },
    }))

    expect(replies.at(-1).markdown.content).toContain('活跃会话')
    expect(replies.at(-1).markdown.content).toContain('会话 A')
    expect(replies.at(-1).markdown.content).toContain('会话 B')
  })

  it('sends history choice menu when matched history sessions exist', async () => {
    const { bridge, manager, replies } = createHarness()
    manager.sessionDatabase.getImSessionsByType.mockReturnValue([
      { session_id: 'hist-1', title: '历史会话 1', updated_at: Date.now() - 1000 },
      { session_id: 'hist-2', title: '历史会话 2', updated_at: Date.now() - 2000 },
    ])

    await bridge._handleMessage(inboundFrame())

    expect(replies.at(-1).markdown.content).toContain('历史会话')
    expect(replies.at(-1).markdown.content).toContain('回复 0')
  })

  it('resumes selected history session after numeric reply', async () => {
    const { bridge, manager, replies } = createHarness()
    const reopened = manager.create({ type: 'chat', source: 'manual', title: '历史会话 1' })
    reopened.imChannel = 'enterprise-weixin'
    manager.sessionDatabase.getImSessionsByType.mockReturnValue([
      { session_id: reopened.id, title: '历史会话 1', updated_at: Date.now() - 1000 },
    ])
    stubSendMessage(manager)

    await bridge._handleMessage(inboundFrame({ text: { content: '第一条消息' } }))
    await bridge._handleMessage(inboundFrame({ text: { content: '1' } }))

    expect(replies.at(-1).markdown.content).toContain('会话恢复中，请等待信息返回后，即可开始聊天')
    expect(bridge._sessionMapper.sessionMap.get('user-a:user-a')).toBe(reopened.id)
  })

  it('creates a new session after choosing 0 from history menu', async () => {
    const { bridge, manager, replies } = createHarness()
    manager.sessionDatabase.getImSessionsByType.mockReturnValue([
      { session_id: 'hist-1', title: '历史会话 1', updated_at: Date.now() - 1000 },
    ])
    const enqueueSpy = vi.spyOn(bridge, '_enqueueInboundMessage').mockResolvedValue()

    await bridge._handleMessage(inboundFrame({ text: { content: '我要新开' } }))
    const beforeCount = manager.sessions.size
    await bridge._handleMessage(inboundFrame({ text: { content: '0' } }))

    expect(manager.sessions.size).toBe(beforeCount + 1)
    expect(replies.at(-1).markdown.content).toContain('正在创建新会话')
    expect(enqueueSpy).toHaveBeenCalled()
  })

  it('binds and sends proactive text to a target', async () => {
    const { bridge, manager, wsClient } = createHarness()
    const created = manager.create({ type: 'chat', source: 'manual', title: '普通会话' })

    const result = await bridge.sendTextToTarget({
      sessionId: created.id,
      userId: 'user-b',
      displayName: 'HydroCoder',
      text: '任务已完成',
    })

    expect(result).toEqual({ success: true, targetId: 'user-b' })
    expect(wsClient.sendMessage).toHaveBeenCalledWith('user-b', {
      msgtype: 'markdown',
      markdown: { content: '任务已完成' },
    })
    expect(bridge.getSessionBinding(created.id)).toEqual({
      targetId: 'user-b',
      userId: 'user-b',
      displayName: 'HydroCoder',
    })
  })

  it('reuses the bound session after proactive send without asking history choice again', async () => {
    const { bridge, manager, replies } = createHarness()
    const sendMessage = stubSendMessage(manager)
    const created = manager.create({ type: 'chat', source: 'manual', title: '普通会话' })
    manager.sessionDatabase.getImSessionsByType.mockReturnValue([
      { session_id: 'hist-1', title: '历史会话 1', updated_at: Date.now() - 1000 },
    ])

    await bridge.sendTextToTarget({
      sessionId: created.id,
      userId: 'user-a',
      displayName: '雷斯林',
      text: '桌面先发一条',
    })

    await bridge._handleMessage(inboundFrame({
      text: { content: '企业微信回复' },
    }))

    expect(replies.some(item => item?.markdown?.content?.includes('历史会话'))).toBe(false)
    expect(sendMessage).toHaveBeenCalledWith(
      created.id,
      '企业微信回复',
      expect.objectContaining({
        meta: expect.objectContaining({
          source: 'im-inbound',
          enterpriseWeixinChatId: 'user-a',
        }),
      })
    )
  })

  it('downloads inbound image messages and submits base64 images to Agent', async () => {
    const { bridge, manager, wsClient } = createHarness()
    const sendMessage = stubSendMessage(manager)

    await bridge._handleMessage(inboundFrame({
      msgtype: 'image',
      image: {
        url: 'https://example.com/assets/remote.png',
        aeskey: 'aes-key',
      },
      text: undefined,
    }))

    expect(wsClient.downloadFile).toHaveBeenCalledWith('https://example.com/assets/remote.png', 'aes-key')
    expect(sendMessage).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        text: '',
        images: [
          expect.objectContaining({
            base64: Buffer.from('image-bytes').toString('base64'),
            mediaType: 'image/png',
          }),
        ],
      }),
      expect.objectContaining({
        meta: expect.objectContaining({
          source: 'im-inbound',
        }),
      })
    )

    const session = Array.from(manager.sessions.values())[0]
    expect(session.messages.find(msg => msg.role === 'user' && msg.source === 'enterprise-weixin')).toEqual(
      expect.objectContaining({
        content: '[图片]',
        images: [
          expect.objectContaining({
            base64: Buffer.from('image-bytes').toString('base64'),
            mediaType: 'image/png',
          }),
        ],
      })
    )
  })

  it('replies with collected agent result images back to enterprise weixin', async () => {
    const { bridge, wsClient } = createHarness()
    const imagePath = path.join(tempDir, 'agent-output.png')
    fs.writeFileSync(imagePath, Buffer.from('agent-image'))

    bridge._replyCollector.startCollect('session-1', {
      webhook: inboundFrame(),
      sendFn: async () => {},
    })
    bridge._replyCollector.addImagePath('session-1', imagePath)

    await bridge._onAgentResult('session-1')

    expect(wsClient.uploadMedia).toHaveBeenCalled()
    expect(wsClient.replyMedia).toHaveBeenCalledWith(expect.any(Object), 'image', expect.stringMatching(/^media-/))
  })

  it('streams assistant text reply back to enterprise weixin', async () => {
    const { bridge, wsClient } = createHarness()
    const frame = inboundFrame()

    bridge._replyCollector.startCollect('session-1', {
      webhook: frame,
      sendFn: async () => {},
    })

    bridge._onAgentMessage('session-1', {
      type: 'assistant',
      content: [
        { type: 'text', text: '第一段' },
        { type: 'text', text: '第二段' },
      ],
    })

    await bridge._onAgentResult('session-1')

    expect(wsClient.replyStreamNonBlocking).toHaveBeenCalled()
    expect(wsClient.replyStreamNonBlocking).toHaveBeenNthCalledWith(
      1,
      frame,
      expect.stringMatching(/^wecom_stream/),
      '第一段',
      false
    )
    expect(wsClient.replyStreamNonBlocking).toHaveBeenNthCalledWith(
      2,
      frame,
      expect.stringMatching(/^wecom_stream/),
      '第二段',
      false
    )
    expect(wsClient.replyStreamNonBlocking).toHaveBeenNthCalledWith(
      3,
      frame,
      expect.stringMatching(/^wecom_stream/),
      '第一段第二段',
      true
    )
  })

  it('sends remaining text on final stream finish when collector has unsent tail', async () => {
    const { bridge, wsClient } = createHarness()
    const frame = inboundFrame()

    bridge._replyCollector.startCollect('session-2', {
      webhook: frame,
      sendFn: async () => {},
    })

    const collector = bridge._replyCollector.getCollector('session-2')
    collector.chunks = ['完整结果']
    collector.sentText = '完整'

    bridge._activeSendChunks.set('session-2', async (chunk, finish) => {
      return wsClient.replyStreamNonBlocking(frame, 'wecom_stream_test', chunk, finish)
    })

    await bridge._onAgentResult('session-2')

    expect(wsClient.replyStreamNonBlocking).toHaveBeenCalledWith(
      frame,
      'wecom_stream_test',
      '结果',
      true
    )
  })

  it('forwards desktop intervention images and collected agent images to enterprise weixin', async () => {
    const { bridge, wsClient } = createHarness()
    const sessionId = 'session-desktop'
    const generatedImagePath = path.join(tempDir, 'generated.png')
    fs.writeFileSync(generatedImagePath, Buffer.from('generated-image'))

    bridge._sessionIdentities.set(sessionId, {
      userId: 'user-a',
      senderId: 'user-a',
      senderName: '雷斯林',
      chatId: 'user-a',
      chatType: 'single',
      chatName: '雷斯林',
    })

    bridge._onDesktopIntervention(sessionId, '', [
      { data: `data:image/png;base64,${Buffer.from('desktop-image').toString('base64')}` },
    ])

    bridge._onAgentMessage(sessionId, {
      content: [
        { type: 'tool_use', input: { imagePath: generatedImagePath } },
      ],
    })

    await bridge._onAgentResult(sessionId)

    expect(wsClient.uploadMedia).toHaveBeenCalledTimes(2)
    expect(wsClient.sendMediaMessage).toHaveBeenCalledTimes(2)
  })
})
