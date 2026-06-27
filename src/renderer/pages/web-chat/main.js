const state = {
  sessions: [],
  activeSessionId: null,
  activeMessages: [],
  sending: false
}

const elements = {
  refreshHealthBtn: document.getElementById('refreshHealthBtn'),
  providerValue: document.getElementById('providerValue'),
  modelValue: document.getElementById('modelValue'),
  apiKeyValue: document.getElementById('apiKeyValue'),
  sessionCountValue: document.getElementById('sessionCountValue'),
  modelSelect: document.getElementById('modelSelect'),
  systemPromptInput: document.getElementById('systemPromptInput'),
  newSessionBtn: document.getElementById('newSessionBtn'),
  sessionList: document.getElementById('sessionList'),
  chatTitle: document.getElementById('chatTitle'),
  chatModel: document.getElementById('chatModel'),
  chatUpdatedAt: document.getElementById('chatUpdatedAt'),
  messageList: document.getElementById('messageList'),
  messageInput: document.getElementById('messageInput'),
  referenceUrlInput: document.getElementById('referenceUrlInput'),
  extraContextInput: document.getElementById('extraContextInput'),
  contextFileInput: document.getElementById('contextFileInput'),
  sendStatus: document.getElementById('sendStatus'),
  sendBtn: document.getElementById('sendBtn'),
  sendPlainBtn: document.getElementById('sendPlainBtn')
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      'Content-Type': 'application/json'
    },
    ...options
  })

  const data = await response.json()
  if (!response.ok || !data.success) {
    throw new Error(data.error || 'Request failed')
  }
  return data.data
}

function formatDateTime(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString('zh-CN', { hour12: false })
}

function renderHealth(data) {
  elements.providerValue.textContent = data.provider || '-'
  elements.modelValue.textContent = data.model || '-'
  elements.apiKeyValue.textContent = data.hasApiKey ? '已配置' : '未配置'
  elements.sessionCountValue.textContent = String(data.sessionCount || 0)
}

function renderSessions() {
  elements.sessionList.innerHTML = ''
  if (state.sessions.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'session-meta'
    empty.textContent = '还没有会话，先创建一个。'
    elements.sessionList.appendChild(empty)
    return
  }

  state.sessions.forEach((session) => {
    const item = document.createElement('button')
    item.type = 'button'
    item.className = `session-item${session.id === state.activeSessionId ? ' active' : ''}`
    item.innerHTML = `
      <div class="session-title">${escapeHtml(session.title || '新对话')}</div>
      <div class="session-meta">${escapeHtml(session.model || '-')} · ${session.messageCount || 0} 条 · ${escapeHtml(formatDateTime(session.updatedAt))}</div>
    `
    item.addEventListener('click', () => {
      loadSession(session.id).catch(showError)
    })
    elements.sessionList.appendChild(item)
  })
}

function renderMessages() {
  elements.messageList.innerHTML = ''
  if (state.activeMessages.length === 0) {
    elements.messageList.innerHTML = `
      <div class="empty-state">
        <h3>开始提问</h3>
        <p>发送一条消息，后端会用 DeepSeek 返回真实回答。</p>
      </div>
    `
    return
  }

  state.activeMessages.forEach((message) => {
    const card = document.createElement('article')
    card.className = `message-card ${message.role}`
    card.innerHTML = `
      <div class="message-head">
        <span class="message-role">${message.role === 'assistant' ? '助手' : '你'}</span>
        <span class="message-time">${escapeHtml(formatDateTime(message.createdAt))}</span>
      </div>
      <div class="message-body">${escapeHtml(message.content || '')}</div>
    `
    elements.messageList.appendChild(card)
  })

  elements.messageList.scrollTop = elements.messageList.scrollHeight
}

function renderActiveSessionMeta(session) {
  elements.chatTitle.textContent = session?.title || '请先创建会话'
  elements.chatModel.textContent = session?.model || '-'
  elements.chatUpdatedAt.textContent = session?.updatedAt ? `更新于 ${formatDateTime(session.updatedAt)}` : '-'
}

function setSending(sending) {
  state.sending = sending
  elements.sendBtn.disabled = sending
  elements.sendPlainBtn.disabled = sending
  elements.sendStatus.textContent = sending ? '发送中...' : '空闲'
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function showError(error) {
  setSending(false)
  elements.sendStatus.textContent = `错误：${error.message}`
}

async function importContextFile(file) {
  if (!file) return
  const text = await file.text()
  const prefix = `[文件: ${file.name}]\n`
  const merged = `${prefix}${text}`.slice(0, 20000)
  elements.extraContextInput.value = merged
  elements.sendStatus.textContent = `已载入文件：${file.name}`
}

async function refreshHealth() {
  const data = await api('/api/health')
  renderHealth(data)
}

async function refreshSessions() {
  const sessions = await api('/api/chat/sessions')
  state.sessions = sessions
  renderSessions()
}

async function loadSession(sessionId) {
  state.activeSessionId = sessionId
  renderSessions()

  const sessions = await api('/api/chat/sessions')
  state.sessions = sessions
  const activeSession = state.sessions.find(session => session.id === sessionId) || null
  renderActiveSessionMeta(activeSession)
  renderSessions()

  state.activeMessages = await api(`/api/chat/sessions/${encodeURIComponent(sessionId)}/messages`)
  renderMessages()
}

async function createSession() {
  const session = await api('/api/chat/sessions', {
    method: 'POST',
    body: JSON.stringify({
      model: elements.modelSelect.value,
      systemPrompt: elements.systemPromptInput.value
    })
  })

  await refreshSessions()
  await loadSession(session.id)
}

async function sendMessage() {
  return sendMessageInternal(false)
}

function buildPayload(content) {
  return {
    content,
    model: elements.modelSelect.value,
    systemPrompt: elements.systemPromptInput.value,
    referenceUrl: elements.referenceUrlInput.value.trim(),
    extraContext: elements.extraContextInput.value.trim()
  }
}

function createPendingCards(userContent) {
  const now = new Date().toISOString()
  const userMessage = {
    id: `pending-user-${Date.now()}`,
    role: 'user',
    content: userContent,
    createdAt: now
  }
  const assistantMessage = {
    id: `pending-assistant-${Date.now()}`,
    role: 'assistant',
    content: '',
    createdAt: now
  }
  state.activeMessages.push(userMessage, assistantMessage)
  renderMessages()
  return { userMessage, assistantMessage }
}

async function streamMessage(payload, pendingAssistantMessage) {
  const response = await fetch(`/api/chat/sessions/${encodeURIComponent(state.activeSessionId)}/messages/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  })

  if (!response.ok || !response.body) {
    let message = 'Stream request failed'
    try {
      const data = await response.json()
      message = data.error || message
    } catch {}
    throw new Error(message)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let fullText = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    fullText += decoder.decode(value, { stream: true })
    pendingAssistantMessage.content = fullText
    renderMessages()
  }

  pendingAssistantMessage.content = fullText
}

async function sendMessageInternal(useStream) {
  if (state.sending) return
  if (!state.activeSessionId) {
    elements.sendStatus.textContent = '请先创建会话'
    return
  }

  const content = elements.messageInput.value.trim()
  if (!content) {
    elements.sendStatus.textContent = '消息不能为空'
    return
  }

  setSending(true)
  elements.sendStatus.textContent = useStream ? '正在流式调用 DeepSeek...' : '正在调用 DeepSeek...'
  const payload = buildPayload(content)
  const pending = useStream ? createPendingCards(content) : null

  try {
    if (useStream) {
      await streamMessage(payload, pending.assistantMessage)
      elements.messageInput.value = ''
      await refreshHealth()
      await refreshSessions()
      await loadSession(state.activeSessionId)
      setSending(false)
      return
    }

    const data = await api(`/api/chat/sessions/${encodeURIComponent(state.activeSessionId)}/messages`, {
      method: 'POST',
      body: JSON.stringify(payload)
    })

    elements.messageInput.value = ''
    await refreshHealth()
    await refreshSessions()
    state.activeMessages.push(data.userMessage, data.assistantMessage)
    renderMessages()

    const updatedSession = state.sessions.find(session => session.id === state.activeSessionId) || data.session
    renderActiveSessionMeta(updatedSession)
    setSending(false)
  } catch (error) {
    if (useStream && pending) {
      state.activeMessages = state.activeMessages.filter(message => (
        message.id !== pending.userMessage.id && message.id !== pending.assistantMessage.id
      ))
      renderMessages()
    }
    showError(error)
  }
}

elements.refreshHealthBtn.addEventListener('click', () => {
  refreshHealth().catch(showError)
})

elements.newSessionBtn.addEventListener('click', () => {
  createSession().catch(showError)
})

elements.sendBtn.addEventListener('click', () => {
  sendMessageInternal(true).catch(showError)
})

elements.sendPlainBtn.addEventListener('click', () => {
  sendMessageInternal(false).catch(showError)
})

elements.messageInput.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    sendMessageInternal(true).catch(showError)
  }
})

elements.contextFileInput.addEventListener('change', async (event) => {
  const file = event.target.files?.[0]
  if (!file) return
  try {
    await importContextFile(file)
  } catch (error) {
    showError(error)
  }
})

Promise.all([refreshHealth(), refreshSessions()]).catch(showError)
