import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const { AgentSessionManager } = await import('../../src/main/agent-session-manager.js')
const { FeishuBridge } = await import('../../src/main/managers/feishu-bridge.js')
const { FeishuEventClient } = await import('../../src/main/managers/feishu-event-client.js')
const { ImSessionMapper } = await import('../../src/main/managers/im-session-mapper.js')

describe('FeishuBridge', () => {
  let tempDir

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hydro-feishu-bridge-'))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  function createManager() {
    const sent = []
    const mainWindow = {
      isDestroyed: () => false,
      webContents: {
        send: (channel, data) => sent.push({ channel, data })
      }
    }
    const configManager = {
      getConfig: () => ({
        settings: { agent: { outputBaseDir: tempDir } },
        feishu: {
          enabled: true,
          appId: 'app-id',
          appSecret: 'app-secret',
          defaultCwd: '',
          maxHistorySessions: 5
        }
      }),
      getDefaultProfile: () => ({ id: 'p1', baseUrl: 'https://example.com' }),
      getAPIProfile: () => null
    }
    const manager = new AgentSessionManager(mainWindow, configManager)
    manager.sessionDatabase = {
      insertAgentMessage: vi.fn(),
      updateAgentConversation: vi.fn(),
      updateAgentConversationTitle: vi.fn(),
      createAgentConversation: vi.fn(() => ({ id: 1 })),
      getAgentConversation: vi.fn((sessionId) => ({
        id: 1,
        session_id: sessionId,
        type: 'feishu',
        title: '飞书历史会话',
        cwd: tempDir,
        source: 'feishu',
        status: 'idle',
        cwd_auto: 0,
        message_count: 0,
        total_cost_usd: 0,
        created_at: Date.now(),
        api_profile_id: null,
        api_base_url: null
      })),
      getImSessionsByType: vi.fn(() => []),
      updateDingTalkMetadata: vi.fn()
    }
    return { mainWindow, configManager, manager, sent }
  }

  it('routes interactive card actions into the command handler', async () => {
    const { configManager, manager, mainWindow } = createManager()
    const bridge = new FeishuBridge(configManager, manager, mainWindow)
    const commandSpy = vi.spyOn(bridge, '_handleCommand').mockResolvedValue()

    await bridge._handleCardAction({
      actionType: 'button',
      actionValue: { intent: 'resume', index: 2 },
      userId: 'ou_xxx',
      chatId: 'oc_xxx'
    })

    expect(commandSpy).toHaveBeenCalledWith('/resume 2', {
      senderId: 'ou_xxx',
      chatId: 'oc_xxx',
      chatType: 'p2p'
    })
  })

  it('supports explicit command payloads from card actions', async () => {
    const { configManager, manager, mainWindow } = createManager()
    const bridge = new FeishuBridge(configManager, manager, mainWindow)
    const commandSpy = vi.spyOn(bridge, '_handleCommand').mockResolvedValue()

    await bridge._handleCardAction({
      actionType: 'button',
      actionValue: { command: 'sessions' },
      userId: 'ou_xxx',
      chatId: 'oc_xxx'
    })

    expect(commandSpy).toHaveBeenCalledWith('/sessions', expect.any(Object))
  })

  it('downloads inbound Feishu images and forwards the message to Agent', async () => {
    const { configManager, manager, mainWindow, sent } = createManager()
    const bridge = new FeishuBridge(configManager, manager, mainWindow)
    const downloadedImage = {
      base64: Buffer.from('image').toString('base64'),
      mediaType: 'image/png'
    }
    vi.spyOn(bridge._api, 'downloadImage').mockResolvedValue(downloadedImage)
    const enqueueMessage = vi.spyOn(bridge, '_enqueueMessage').mockImplementation(() => {})

    await bridge._handleFeishuMessage({
      msgId: 'om_1',
      senderId: 'ou_xxx',
      chatId: 'oc_xxx',
      chatType: 'p2p',
      text: '请分析这张图',
      images: [{ imageKey: 'img_1', messageId: 'om_1' }]
    })

    const session = Array.from(manager.sessions.values())[0]
    expect(bridge._api.downloadImage).toHaveBeenCalledWith('img_1', 'om_1')
    expect(enqueueMessage).toHaveBeenCalledWith(
      session.id,
      {
        text: '请分析这张图',
        images: [downloadedImage]
      },
      'ou_xxx',
      'oc_xxx',
      'p2p'
    )
    expect(sent.map(item => item.channel)).toEqual([
      'feishu:sessionCreated',
      'feishu:messageReceived'
    ])
  })

  it('sends desktop intervention images back to Feishu on agent result', async () => {
    const { configManager, manager, mainWindow } = createManager()
    const bridge = new FeishuBridge(configManager, manager, mainWindow)
    const uploadImage = vi.spyOn(bridge._api, 'uploadImage').mockResolvedValue('img_uploaded')
    const sendImageMessage = vi.spyOn(bridge._api, 'sendImageMessage').mockResolvedValue('om_img')
    const sendTextMessage = vi.spyOn(bridge._api, 'sendTextMessage').mockResolvedValue('om_text')

    const session = manager.create({ type: 'feishu', source: 'feishu', title: '飞书会话', cwd: tempDir })
    bridge._sessionMapper.sessionMap.set('ou_xxx:oc_xxx', session.id)
    bridge._sessionIdentities.set(session.id, {
      senderId: 'ou_xxx',
      chatId: 'oc_xxx',
      chatType: 'p2p'
    })

    bridge._onDesktopIntervention(session.id, '请看这张标注图', [
      {
        base64: Buffer.from('pngdata').toString('base64'),
        mediaType: 'image/png'
      }
    ])

    await bridge._onAgentResult(session.id)

    expect(sendTextMessage).toHaveBeenCalledWith(
      'open_id',
      'ou_xxx',
      expect.stringContaining('请看这张标注图')
    )
    expect(uploadImage).toHaveBeenCalledTimes(1)
    expect(sendImageMessage).toHaveBeenCalledWith('open_id', 'ou_xxx', 'img_uploaded')
  })

  it('lists active sessions for the current Feishu chat', async () => {
    const { configManager, manager, mainWindow } = createManager()
    const bridge = new FeishuBridge(configManager, manager, mainWindow)
    const sendTextMessage = vi.spyOn(bridge._api, 'sendTextMessage').mockResolvedValue('om_text')

    const created = manager.create({ type: 'feishu', source: 'feishu', title: '当前飞书会话', cwd: tempDir })
    const session = manager.sessions.get(created.id)
    session.queryGenerator = {}
    bridge._sessionMapper.sessionMap.set('ou_xxx:oc_xxx', session.id)
    bridge._sessionIdentities.set(session.id, {
      senderId: 'ou_xxx',
      chatId: 'oc_xxx',
      chatType: 'p2p'
    })

    await bridge._handleCommand('/sessions', {
      senderId: 'ou_xxx',
      chatId: 'oc_xxx',
      chatType: 'p2p'
    })

    expect(sendTextMessage).toHaveBeenCalledWith(
      'open_id',
      'ou_xxx',
      expect.stringContaining('当前飞书会话')
    )
  })

  it('renames the active Feishu session', async () => {
    const { configManager, manager, mainWindow } = createManager()
    const bridge = new FeishuBridge(configManager, manager, mainWindow)
    const sendTextMessage = vi.spyOn(bridge._api, 'sendTextMessage').mockResolvedValue('om_text')
    const rename = vi.spyOn(manager, 'rename').mockImplementation(() => true)

    const created = manager.create({ type: 'feishu', source: 'feishu', title: '旧标题', cwd: tempDir })
    const session = manager.sessions.get(created.id)
    bridge._sessionMapper.sessionMap.set('ou_xxx:oc_xxx', session.id)
    bridge._sessionIdentities.set(session.id, {
      senderId: 'ou_xxx',
      chatId: 'oc_xxx',
      chatType: 'p2p'
    })

    await bridge._handleCommand('/rename 新标题', {
      senderId: 'ou_xxx',
      chatId: 'oc_xxx',
      chatType: 'p2p'
    })

    expect(rename).toHaveBeenCalledWith(session.id, '新标题')
    expect(sendTextMessage).toHaveBeenCalledWith('open_id', 'ou_xxx', '会话已重命名为：新标题')
  })

  it('closes the active Feishu session', async () => {
    const { configManager, manager, mainWindow, sent } = createManager()
    const bridge = new FeishuBridge(configManager, manager, mainWindow)
    const sendTextMessage = vi.spyOn(bridge._api, 'sendTextMessage').mockResolvedValue('om_text')
    const close = vi.spyOn(manager, 'close').mockResolvedValue()

    const created = manager.create({ type: 'feishu', source: 'feishu', title: '待关闭会话', cwd: tempDir })
    const session = manager.sessions.get(created.id)
    session.queryGenerator = {}
    bridge._sessionMapper.sessionMap.set('ou_xxx:oc_xxx', session.id)
    bridge._sessionIdentities.set(session.id, {
      senderId: 'ou_xxx',
      chatId: 'oc_xxx',
      chatType: 'p2p'
    })

    await bridge._handleCommand('/close', {
      senderId: 'ou_xxx',
      chatId: 'oc_xxx',
      chatType: 'p2p'
    })

    expect(close).toHaveBeenCalledWith(session.id)
    expect(sendTextMessage).toHaveBeenCalledWith(
      'open_id',
      'ou_xxx',
      expect.stringContaining('会话已关闭')
    )
    expect(sent.find(item => item.channel === 'feishu:sessionClosed')?.data).toEqual({ sessionId: session.id })
  })

  it('creates a new Feishu session with /new', async () => {
    const { configManager, manager, mainWindow, sent } = createManager()
    const bridge = new FeishuBridge(configManager, manager, mainWindow)
    const sendTextMessage = vi.spyOn(bridge._api, 'sendTextMessage').mockResolvedValue('om_text')

    await bridge._handleCommand('/new', {
      senderId: 'ou_xxx',
      chatId: 'oc_xxx',
      chatType: 'p2p'
    })

    const session = Array.from(manager.sessions.values())[0]
    expect(session).toBeTruthy()
    expect(session.type).toBe('feishu')
    expect(sendTextMessage).toHaveBeenCalledWith('open_id', 'ou_xxx', '已创建新会话')
    expect(sent.find(item => item.channel === 'feishu:sessionCreated')?.data.sessionId).toBe(session.id)
  })

  it('restores a historical Feishu session with /resume', async () => {
    const { configManager, manager, mainWindow, sent } = createManager()
    const bridge = new FeishuBridge(configManager, manager, mainWindow)
    const sendTextMessage = vi.spyOn(bridge._api, 'sendTextMessage').mockResolvedValue('om_text')
    vi.spyOn(bridge._sessionMapper, '_queryHistorySessions').mockResolvedValue([
      { session_id: 'hist-1', title: '历史会话 1' }
    ])
    const reopen = vi.spyOn(manager, 'reopen').mockImplementation((sessionId) => {
      manager.sessions.set(sessionId, {
        id: sessionId,
        type: 'feishu',
        title: '历史会话 1',
        cwd: tempDir,
        source: 'feishu'
      })
      return { id: sessionId, type: 'feishu', title: '历史会话 1' }
    })

    await bridge._handleCommand('/resume 1', {
      senderId: 'ou_xxx',
      chatId: 'oc_xxx',
      chatType: 'p2p'
    })

    expect(reopen).toHaveBeenCalledWith('hist-1')
    expect(sendTextMessage).toHaveBeenCalledWith('open_id', 'ou_xxx', '已恢复会话')
    expect(sent.find(item => item.channel === 'feishu:sessionCreated')?.data.sessionId).toBe('hist-1')
  })

  it('reports current Feishu bridge status with /status', async () => {
    const { configManager, manager, mainWindow } = createManager()
    const bridge = new FeishuBridge(configManager, manager, mainWindow)
    bridge._eventClient._connected = true
    const sendTextMessage = vi.spyOn(bridge._api, 'sendTextMessage').mockResolvedValue('om_text')

    const created = manager.create({ type: 'feishu', source: 'feishu', title: '状态会话', cwd: tempDir })
    const session = manager.sessions.get(created.id)
    bridge._sessionMapper.sessionMap.set('ou_xxx:oc_xxx', session.id)
    bridge._sessionIdentities.set(session.id, {
      senderId: 'ou_xxx',
      chatId: 'oc_xxx',
      chatType: 'p2p'
    })

    await bridge._handleCommand('/status', {
      senderId: 'ou_xxx',
      chatId: 'oc_xxx',
      chatType: 'p2p'
    })

    expect(sendTextMessage).toHaveBeenCalledWith(
      'open_id',
      'ou_xxx',
      expect.stringContaining('当前会话: 状态会话')
    )
  })

  it('shows a historical session choice menu with /resume and no index', async () => {
    const { configManager, manager, mainWindow } = createManager()
    const bridge = new FeishuBridge(configManager, manager, mainWindow)
    const sendTextMessage = vi.spyOn(bridge._api, 'sendTextMessage').mockResolvedValue('om_text')
    vi.spyOn(bridge._sessionMapper, '_queryHistorySessions').mockResolvedValue([
      { session_id: 'hist-1', title: '历史会话 1' },
      { session_id: 'hist-2', title: '历史会话 2' }
    ])
    vi.spyOn(bridge._sessionMapper, 'initPendingChoice').mockImplementation(async (_mapKey, _history, onSendChoiceMenu) => {
      await onSendChoiceMenu('检测到 2 个历史会话，请回复数字选择：\n0 — 创建新会话\n1 — 历史会话 1\n2 — 历史会话 2')
      return { sessionId: null }
    })

    await bridge._handleCommand('/resume', {
      senderId: 'ou_xxx',
      chatId: 'oc_xxx',
      chatType: 'p2p'
    })

    expect(sendTextMessage).toHaveBeenCalledWith(
      'open_id',
      'ou_xxx',
      expect.stringContaining('检测到 2 个历史会话')
    )
  })
})

describe('ImSessionMapper', () => {
  it('queries history sessions with IM type isolation when database supports it', async () => {
    const getImSessionsByType = vi.fn(() => [{ session_id: 'f-1', type: 'feishu' }])
    const mapper = new ImSessionMapper({
      agentSessionManager: { sessions: new Map() },
      sessionDatabase: { getImSessionsByType },
      imType: 'feishu',
      maxHistorySessions: 7,
      buildIdentityKey: (identity) => `${identity.userId}:${identity.chatId}`,
      buildSessionTitle: () => '飞书会话'
    })

    const result = await mapper._queryHistorySessions({
      userId: 'ou_xxx',
      chatId: 'oc_xxx'
    })

    expect(getImSessionsByType).toHaveBeenCalledWith('feishu', 'ou_xxx', 'oc_xxx', 7)
    expect(result).toEqual([{ session_id: 'f-1', type: 'feishu' }])
  })
})

describe('FeishuEventClient', () => {
  it('extracts image_key from JSON content for image messages', () => {
    const client = new FeishuEventClient()
    const images = client._extractImages({
      message_type: 'image',
      content: JSON.stringify({
        image_key: 'img_v3_0211u_456f155b-671f-4139-9c25-6e5748842e8g'
      })
    }, 'om_x100')

    expect(images).toEqual([{
      imageKey: 'img_v3_0211u_456f155b-671f-4139-9c25-6e5748842e8g',
      messageId: 'om_x100'
    }])
  })
})
