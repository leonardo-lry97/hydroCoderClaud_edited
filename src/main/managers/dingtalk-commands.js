/**
 * DingTalk Commands
 * 钉钉 / 前缀命令处理（从 dingtalk-bridge.js 提取，通过 mixin 混入）
 *
 * 所有方法的 this 指向 DingTalkBridge 实例
 */

const fs = require('fs')
const path = require('path')
const {
  resolveRenameCommand,
  dispatchImCommand,
} = require('./im-command-executor')
const { activateNewSession, resolveResumeSelection } = require('./im-session-command-flow')
const { buildHistoryChoiceMenuText } = require('./im-command-presenter')
const {
  buildImCommandHelpText,
  buildAlreadyConnectedText,
  buildSessionSwitchedText,
  buildSessionActivatingText,
  buildSessionCreatingText,
  buildNoHistoryText,
  buildRenameMissingSessionText,
  buildRenamePromptText,
  buildRenameSuccessText,
  buildUnknownCommandText,
  resolveCommandCwd,
  mergeCurrentSessionIntoHistory,
} = require('./im-command-policy')
const { runResumePostAction } = require('./im-resume-post-action')

function buildSessionReplyingText(title) {
  return `✅ 已切换到会话：${title || '当前会话'}\n\n当前正在回复，请等待完成`
}

function buildDingTalkCommandContext(context = {}, webhook = null) {
  return {
    mapKey: context?.mapKey || '',
    senderStaffId: context?.senderStaffId || '',
    senderNick: context?.senderNick || '',
    conversationId: context?.conversationId || '',
    conversationTitle: context?.conversationTitle || '',
    conversationType: context?.conversationType || '',
    robotCode: context?.robotCode || '',
    sessionWebhook: webhook || null,
  }
}

function mergeDingTalkHistoryRows(...groups) {
  const seen = new Set()
  return groups
    .flat()
    .filter((row) => {
      const sessionId = row?.session_id || row?.sessionId || row?.id || null
      if (!sessionId || seen.has(sessionId)) return false
      seen.add(sessionId)
      return true
    })
    .sort((a, b) => (b?.updated_at || 0) - (a?.updated_at || 0))
}

function getCurrentBoundHistoryRow(bridge, db, staffId) {
  const boundSessionId = typeof bridge?._findBoundSessionIdByStaffId === 'function'
    ? bridge._findBoundSessionIdByStaffId(staffId)
    : null
  if (!boundSessionId) return null
  const row = db?.getAgentConversation?.(boundSessionId)
  if (
    row
    && row.status !== 'closed'
    && row.im_channel === 'dingtalk'
    && row.im_user_id === staffId
  ) {
    return row
  }
  const liveSession = bridge?.agentSessionManager?.sessions?.get(boundSessionId)
  if (!liveSession) return null
  return {
    session_id: boundSessionId,
    title: liveSession.title || boundSessionId,
    cwd: liveSession.cwd || null,
    api_profile_id: liveSession.apiProfileId || null,
    updated_at: liveSession.updatedAt ? new Date(liveSession.updatedAt).getTime() : Date.now(),
    type: liveSession.type,
    source: liveSession.source,
    im_channel: 'dingtalk',
    im_user_id: staffId,
    im_chat_id: '',
    status: liveSession.status || 'idle'
  }
}

function buildCurrentHistoryRow(bridge, db, currentSessionId, { senderStaffId, conversationId, conversationType }) {
  if (!currentSessionId) return null

  const liveCurrent = bridge?.agentSessionManager?.sessions?.get(currentSessionId) || null
  const dbRow = db?.getAgentConversation?.(currentSessionId) || null
  if (!liveCurrent && (!dbRow || dbRow.status === 'closed')) return null
  const isGroupChat = String(conversationType || '').trim() === '2'

  return {
    ...(dbRow || {}),
    session_id: dbRow?.session_id || liveCurrent?.id || currentSessionId,
    title: dbRow?.title || liveCurrent?.title || currentSessionId,
    cwd: dbRow?.cwd || liveCurrent?.cwd || null,
    api_profile_id: dbRow?.api_profile_id || liveCurrent?.apiProfileId || null,
    updated_at: dbRow?.updated_at || (liveCurrent?.updatedAt ? new Date(liveCurrent.updatedAt).getTime() : Date.now()),
    type: dbRow?.type || liveCurrent?.type || 'chat',
    source: dbRow?.source || liveCurrent?.source || 'im-inbound',
    im_channel: 'dingtalk',
    im_user_id: dbRow?.im_user_id || (isGroupChat ? '' : (senderStaffId || '')),
    im_chat_id: dbRow?.im_chat_id || conversationId || '',
    status: dbRow?.status || liveCurrent?.status || 'idle'
  }
}

function loadDingTalkHistorySessions(bridge, {
  currentSessionId,
  senderStaffId,
  conversationId,
  conversationType,
}) {
  const db = bridge?.agentSessionManager?.sessionDatabase
  const limit = bridge?.configManager?.getConfig?.()?.dingtalk?.maxHistorySessions || 5
  if (!db || !conversationId) {
    return { db, limit, sessions: [] }
  }

  const isGroupChat = String(conversationType) === '2'
  const queryUserId = isGroupChat ? '' : senderStaffId
  const exactSessions = db.getImSessionsByType('dingtalk', queryUserId, conversationId, limit)
  const boundHistoryRow = isGroupChat ? null : getCurrentBoundHistoryRow(bridge, db, senderStaffId)
  const mergedHistory = mergeDingTalkHistoryRows(exactSessions, boundHistoryRow ? [boundHistoryRow] : [])
  const currentRow = buildCurrentHistoryRow(bridge, db, currentSessionId, {
    senderStaffId,
    conversationId,
    conversationType,
  })
  const sessions = mergeCurrentSessionIntoHistory({
    history: mergedHistory,
    currentSessionId,
    currentRow,
  }).slice(0, limit)

  return { db, limit, sessions }
}

module.exports = {
  // ============================================================
  // P0 命令层
  // 新增命令：在 _handleCommand 的 switch 里加 case，再写 _cmdXxx 方法
  // ============================================================

  /**
   * 命令分发器
   *
   * 原则：收到新命令时，清空所有历史状态（pending choice、原始消息等）
   * 命令是独立操作，不应受之前状态影响，也不应把历史消息发送给 Agent
   */
  async _handleCommand(text, webhook, context) {
    console.log('[DingTalk] _handleCommand called, text:', text, 'context:', context)
    const commandContext = buildDingTalkCommandContext(context, webhook)
    const dispatchResult = await dispatchImCommand({
      text,
      normalizeText: (rawText) => String(rawText || '').trim(),
      beforeExecute: ({ command, args }) => {
        const { mapKey } = context
        if (mapKey && this._pendingChoices.has(mapKey)) {
          console.log('[DingTalk] _handleCommand: clearing pending choice for', mapKey)
          this._clearPendingChoice(mapKey)
        }
        console.log('[DingTalk] _handleCommand: executing command:', command, 'args:', args)
      },
      handlers: {
        help: () => this._cmdHelp(commandContext),
        status: () => this._cmdStatus(commandContext),
        close: ({ args }) => this._cmdClose(args, context),
        new: ({ args }) => this._cmdNew(args, context, webhook),
        resume: ({ args }) => this._cmdResume(args, context, webhook),
        rename: ({ args }) => this._cmdRename(args, context),
      },
      onUnknown: ({ command }) => `❓ ${buildUnknownCommandText(command)}`,
    })
    const reply = dispatchResult?.result

    if (reply != null) {
      console.log('[DingTalk] _handleCommand: sending reply, length:', reply.length)
      await this._replyToDingTalk(webhook, reply)
    }
  },

  _cmdHelp(_context = null) {
    return buildImCommandHelpText({
      title: '📋 可用命令：',
      includeDirectoryArg: true,
      includeHistoryHint: true,
    })
  },

  async _cmdResume(args, { mapKey, senderStaffId, senderNick, conversationId, conversationTitle, conversationType, robotCode }, webhook) {
    // 获取当前活跃会话（如果有）
    const currentSessionId = this._resolveActiveSessionId(mapKey)
    const currentSession = currentSessionId ? this.agentSessionManager.sessions.get(currentSessionId) : null
    const identity = this._buildSessionIdentity(
      senderStaffId,
      senderNick,
      conversationId,
      conversationTitle,
      conversationType
    )

    // 如果正在 streaming，不允许操作
    if (currentSession?.status === 'streaming') {
      return '⏳ AI 正在响应中，请等待完成后再操作'
    }

    // 查询历史会话
    const { db, limit, sessions } = loadDingTalkHistorySessions(this, {
      currentSessionId,
      senderStaffId,
      conversationId,
      conversationType,
    })
    if (!db || !conversationId) return '📭 没有历史会话记录'

    if (!sessions || sessions.length === 0) return `📭 ${buildNoHistoryText()}`

    // 直接指定编号 → 立即恢复
    const numArg = parseInt(args[0])
    if (!isNaN(numArg)) {
      const selection = resolveResumeSelection({
        history: sessions,
        selectedIndex: numArg,
        currentSessionId,
        currentSession,
      })
      if (selection.action === 'invalid_index') {
        return `❌ 编号错误：请输入 1-${selection.max} 之间的数字`
      }
      const selectedRow = selection.selected

      // 如果选择的就是当前会话，提示无需切换
      if (selection.action === 'already_connected') {
        return buildAlreadyConnectedText(selectedRow.title)
      }

      const result = await this._sessionMapper.handleDirectChoice(
        mapKey,
        sessions,
        String(selection.index),
        identity
      )
      const resumedSessionId = result?.sessionId || null
      if (!resumedSessionId) {
        return `❌ 无法恢复该会话，可能已被删除\n\n发送任意消息可开始新会话`
      }

      const session = this.agentSessionManager.sessions.get(resumedSessionId) || this.agentSessionManager.reopen(resumedSessionId)
      if (session) {
        if (!session.meta) session.meta = {}
        session.meta.conversationId = conversationId
      }

      this._restoreSessionAfterExplicitChoice(mapKey, senderStaffId)
      this._notifyFrontend('dingtalk:sessionCreated', {
        sessionId: resumedSessionId,
        staffId: senderStaffId,
        nickname: senderNick,
        conversationId,
        conversationTitle,
        title: result?.selectedSession?.title || session?.title || resumedSessionId
      })

      const resumedSession = this.agentSessionManager.sessions.get(resumedSessionId) || null
      const shouldWaitForReply = resumedSession?.status === 'streaming'
      if (result.wasActivated) {
        return shouldWaitForReply
          ? buildSessionReplyingText(result?.selectedSession?.title || resumedSessionId)
          : buildSessionSwitchedText(result?.selectedSession?.title || resumedSessionId)
      }

      await this._replyToDingTalk(webhook, buildSessionActivatingText())
      await runResumePostAction({
        pendingMessage: null,
        clearPendingMessage: () => {},
        wasActivated: result.wasActivated,
        notifyMessageReceived: () => {
          this._notifyFrontend('dingtalk:messageReceived', {
            sessionId: resumedSessionId, senderNick, text: 'hello'
          })
        },
        enqueueHello: async () => {
          this._enqueueMessage(resumedSessionId, 'hello', webhook, senderNick, {
            robotCode, senderStaffId, conversationId, conversationType
          })
        },
      })
      return null  // 已由 _replyToDingTalk 回复
    }

    // 无参数 → 显示选择菜单（传入当前会话 ID 用于标记）
    this._setPendingChoice(mapKey, { sessions, originalMessage: null, robotCode: null, senderStaffId, source: 'resume-command' })
    await this._sendChoiceMenu(webhook, sessions, currentSessionId)
    return null  // 已由 _sendChoiceMenu 回复
  },

  _cmdRename(args, { mapKey }) {
    const renameDecision = resolveRenameCommand({
      args,
      currentSessionId: this._resolveActiveSessionId(mapKey),
    })
    if (renameDecision.action === 'missing_current') return buildRenameMissingSessionText()
    if (renameDecision.action === 'missing_title') return buildRenamePromptText()

    this.agentSessionManager.rename(renameDecision.sessionId, renameDecision.newTitle)
    return `✅ ${buildRenameSuccessText(renameDecision.newTitle)}`
  },

  _cmdStatus(context) {
    const { mapKey, senderStaffId, conversationId, conversationType } = context || {}
    const currentSessionId = mapKey ? this._resolveActiveSessionId(mapKey) : null
    const { db, limit, sessions } = loadDingTalkHistorySessions(this, {
      currentSessionId,
      senderStaffId,
      conversationId,
      conversationType,
    })
    if (!db || !conversationId) return '📭 没有历史会话记录'
    if (!sessions || sessions.length === 0) return `📭 ${buildNoHistoryText()}`
    return buildHistoryChoiceMenuText({
      sessions,
      currentSessionId,
      maxSessions: limit,
      getDirName: (cwd) => path.basename(cwd),
      getProfileName: (profileId) => profileId
        ? (this.configManager?.getAPIProfile(profileId)?.name || '未知配置')
        : '默认配置',
      isSessionActivated: (sessionId) => !!this.agentSessionManager.sessions.get(sessionId)?.queryGenerator,
      title: '当前会话状态：',
      includeActionHint: false,
      includeNewSessionHint: false,
    })
  },

  async _cmdClose(args, context) {
    if (Array.isArray(args) && args.length > 0) {
      return '❌ /close 不支持带编号或参数，请直接使用 /close'
    }

    const { mapKey } = context
    const currentSessionId = this._resolveActiveSessionId(mapKey)
    if (!currentSessionId) {
      return '当前没有连接会话，无需关闭\n\n发送任意消息可开始新会话'
    }

    const currentSession = this.agentSessionManager.sessions.get(currentSessionId) || null
    if (currentSession?.status === 'streaming') {
      return '⏳ AI 正在响应中，请等待完成后再关闭'
    }

    this._suppressProactiveRebind(currentSessionId)
    await this.agentSessionManager.close(currentSessionId)

    for (const [key, sid] of this.sessionMap.entries()) {
      if (sid !== currentSessionId) continue
      this._clearSessionState(currentSessionId, key, { clearTargetBinding: true })
      this._clearPendingChoice(key)
      if (key === mapKey) break
    }
    this._notifyFrontend('dingtalk:sessionClosed', { sessionId: currentSessionId })
    return '✅ 会话已关闭'
  },

  async _cmdNew(args, { mapKey, senderStaffId, senderNick, conversationId, conversationTitle, robotCode, conversationType }, webhook) {
    const currentSessionId = this._resolveActiveSessionId(mapKey)
    if (currentSessionId) {
      const session = this.agentSessionManager.sessions.get(currentSessionId)
      if (session?.status === 'streaming') {
        return '⏳ AI 正在响应中，请等待完成后再操作'
      }
    }

    this._clearPendingChoice(mapKey)

    let cwd
    try {
      cwd = resolveCommandCwd({
        args,
        outputBaseDir: this.agentSessionManager._getOutputBaseDir(),
        imSubdir: 'dingtalk',
      })
    } catch (err) {
      return `❌ ${err.message}`
    }

    const sessionId = await this._createNewSession(senderStaffId, senderNick, conversationId, conversationTitle, mapKey, {
      cwd,
      conversationType,
    })
    this._restoreSessionAfterExplicitChoice(mapKey, senderStaffId)

    // 发送"会话创建中"提示
    await this._replyToDingTalk(webhook, buildSessionCreatingText())

    await activateNewSession({
      sessionId,
      notifyMessageReceived: () => {
        this._notifyFrontend('dingtalk:messageReceived', {
          sessionId,
          senderNick,
          text: 'hello'
        })
      },
      enqueueHello: async () => {
        this._enqueueMessage(sessionId, 'hello', webhook, senderNick, { robotCode, senderStaffId, conversationId, conversationType })
      },
    })

    return null  // 已由 _replyToDingTalk 回复
  }
}
