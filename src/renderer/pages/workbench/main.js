const state = {
  overview: null,
  tasks: [],
  sessions: [],
  selectedTemplateId: 'summarize_page',
  activeSessionId: null
}

const elements = {
  refreshOverviewBtn: document.getElementById('refreshOverviewBtn'),
  overviewSessions: document.getElementById('overviewSessions'),
  overviewMessages: document.getElementById('overviewMessages'),
  overviewTasks: document.getElementById('overviewTasks'),
  overviewModel: document.getElementById('overviewModel'),
  templateList: document.getElementById('templateList'),
  taskList: document.getElementById('taskList'),
  templateSelect: document.getElementById('templateSelect'),
  referenceUrlInput: document.getElementById('referenceUrlInput'),
  promptInput: document.getElementById('promptInput'),
  extraContextInput: document.getElementById('extraContextInput'),
  runTaskBtn: document.getElementById('runTaskBtn'),
  newSessionBtn: document.getElementById('newSessionBtn'),
  runStatus: document.getElementById('runStatus'),
  resultMeta: document.getElementById('resultMeta'),
  resultOutput: document.getElementById('resultOutput'),
  sessionList: document.getElementById('sessionList'),
  messageList: document.getElementById('messageList')
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

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function formatDateTime(value) {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('zh-CN', { hour12: false })
}

function renderOverview() {
  elements.overviewSessions.textContent = String(state.overview?.sessionCount || 0)
  elements.overviewMessages.textContent = String(state.overview?.messageCount || 0)
  elements.overviewTasks.textContent = String(state.overview?.taskRunCount || 0)
  elements.overviewModel.textContent = state.overview?.defaultModel || '-'

  const templates = state.overview?.templates || []
  elements.templateSelect.innerHTML = templates.map((template) => (
    `<option value="${escapeHtml(template.id)}">${escapeHtml(template.title)}</option>`
  )).join('')
  elements.templateSelect.value = state.selectedTemplateId

  elements.templateList.innerHTML = templates.map((template) => `
    <button class="template-item${template.id === state.selectedTemplateId ? ' active' : ''}" data-template-id="${escapeHtml(template.id)}" type="button">
      <strong>${escapeHtml(template.title)}</strong>
      <div class="task-meta">${escapeHtml(template.id)}</div>
    </button>
  `).join('')

  for (const button of elements.templateList.querySelectorAll('[data-template-id]')) {
    button.addEventListener('click', () => {
      state.selectedTemplateId = button.dataset.templateId
      elements.templateSelect.value = state.selectedTemplateId
      renderOverview()
    })
  }
}

function renderTasks() {
  if (state.tasks.length === 0) {
    elements.taskList.innerHTML = '<div class="task-meta">还没有任务记录。</div>'
    return
  }

  elements.taskList.innerHTML = state.tasks.map((task) => `
    <button class="task-item" data-task-id="${escapeHtml(task.id)}" type="button">
      <strong>${escapeHtml(task.title)}</strong>
      <div class="task-meta">${escapeHtml(task.status)} · ${escapeHtml(formatDateTime(task.completedAt || task.createdAt))}</div>
    </button>
  `).join('')

  for (const button of elements.taskList.querySelectorAll('[data-task-id]')) {
    button.addEventListener('click', () => {
      const task = state.tasks.find(item => item.id === button.dataset.taskId)
      if (!task) return
      elements.resultMeta.textContent = `${task.title} · ${formatDateTime(task.completedAt || task.createdAt)}`
      elements.resultOutput.textContent = task.resultContent || task.prompt
      if (task.sessionId) {
        loadSession(task.sessionId).catch(showError)
      }
    })
  }
}

function renderSessions() {
  if (state.sessions.length === 0) {
    elements.sessionList.innerHTML = '<div class="session-meta">暂无会话</div>'
    return
  }

  elements.sessionList.innerHTML = state.sessions.map((session) => `
    <button class="session-item${session.id === state.activeSessionId ? ' active' : ''}" data-session-id="${escapeHtml(session.id)}" type="button">
      <strong>${escapeHtml(session.title)}</strong>
      <div class="session-meta">${escapeHtml(session.model)} · ${session.messageCount || 0} 条 · ${escapeHtml(formatDateTime(session.updatedAt))}</div>
    </button>
  `).join('')

  for (const button of elements.sessionList.querySelectorAll('[data-session-id]')) {
    button.addEventListener('click', () => {
      loadSession(button.dataset.sessionId).catch(showError)
    })
  }
}

async function renderMessages(messages = []) {
  if (messages.length === 0) {
    elements.messageList.innerHTML = '<div class="session-meta">选择一个会话后查看消息。</div>'
    return
  }

  elements.messageList.innerHTML = messages.map((message) => `
    <article class="message-card ${escapeHtml(message.role)}">
      <div class="message-head">
        <span class="message-role">${message.role === 'assistant' ? '助手' : '你'}</span>
        <span class="message-time">${escapeHtml(formatDateTime(message.createdAt))}</span>
      </div>
      <div class="message-body">${escapeHtml(message.content || '')}</div>
    </article>
  `).join('')
}

async function loadOverview() {
  state.overview = await api('/api/workbench/overview')
  renderOverview()
}

async function loadTasks() {
  state.tasks = await api('/api/workbench/tasks')
  renderTasks()
}

async function loadSessions() {
  state.sessions = await api('/api/chat/sessions')
  renderSessions()
}

async function loadSession(sessionId) {
  state.activeSessionId = sessionId
  renderSessions()
  const messages = await api(`/api/chat/sessions/${encodeURIComponent(sessionId)}/messages`)
  await renderMessages(messages)
}

async function createSession() {
  const session = await api('/api/chat/sessions', {
    method: 'POST',
    body: JSON.stringify({
      model: state.overview?.defaultModel || 'deepseek-chat',
      systemPrompt: '你是 Hydro Web Workbench 助手，请根据任务上下文给出可执行结果。'
    })
  })
  await loadSessions()
  await loadSession(session.id)
}

async function runTask() {
  elements.runTaskBtn.disabled = true
  elements.runStatus.textContent = '任务执行中...'
  try {
    const result = await api('/api/workbench/tasks', {
      method: 'POST',
      body: JSON.stringify({
        templateId: state.selectedTemplateId,
        prompt: elements.promptInput.value.trim(),
        referenceUrl: elements.referenceUrlInput.value.trim(),
        extraContext: elements.extraContextInput.value.trim(),
        sessionId: state.activeSessionId || undefined,
        model: state.overview?.defaultModel || 'deepseek-chat'
      })
    })

    elements.resultMeta.textContent = `${result.taskRun.title} · ${formatDateTime(result.taskRun.completedAt)}`
    elements.resultOutput.textContent = result.taskRun.resultContent || ''
    state.activeSessionId = result.session.id
    elements.runStatus.textContent = '任务已完成'
    await Promise.all([loadOverview(), loadTasks(), loadSessions(), loadSession(result.session.id)])
  } catch (error) {
    showError(error)
  } finally {
    elements.runTaskBtn.disabled = false
  }
}

function showError(error) {
  elements.runStatus.textContent = `错误：${error.message}`
}

elements.refreshOverviewBtn.addEventListener('click', () => {
  Promise.all([loadOverview(), loadTasks(), loadSessions()]).catch(showError)
})

elements.templateSelect.addEventListener('change', (event) => {
  state.selectedTemplateId = event.target.value
  renderOverview()
})

elements.runTaskBtn.addEventListener('click', () => {
  runTask().catch(showError)
})

elements.newSessionBtn.addEventListener('click', () => {
  createSession().catch(showError)
})

Promise.all([loadOverview(), loadTasks(), loadSessions()]).catch(showError)
