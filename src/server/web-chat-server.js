const http = require('http')
const fs = require('fs')
const path = require('path')
const { URL } = require('url')
const { WebChatDatabase } = require('./web-chat-db')

const HOST = process.env.WEB_HOST || '0.0.0.0'
const PORT = Number.parseInt(process.env.PORT || process.env.WEB_PORT || '8787', 10)
const DIST_DIR = path.resolve(__dirname, '../renderer/pages-dist')
const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1'
const DEFAULT_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat'
const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.DEEPSEEK_TIMEOUT_MS || '120000', 10)
const db = new WebChatDatabase()
const TASK_TEMPLATES = {
  summarize_page: {
    id: 'summarize_page',
    title: '网页总结',
    systemPrompt: '你是网页研究助手。请提炼网页的核心信息，输出简洁且结构清晰的中文总结。',
    buildPrompt: (body) => body.prompt || '请总结这个网页的核心内容，并给出 3 条要点。'
  },
  compare_options: {
    id: 'compare_options',
    title: '方案对比',
    systemPrompt: '你是分析顾问。请把输入内容整理成中文对比结论，突出差异、优缺点和建议。',
    buildPrompt: (body) => body.prompt || '请比较这几个方案，并给出推荐。'
  },
  draft_report: {
    id: 'draft_report',
    title: '初稿生成',
    systemPrompt: '你是写作助手。请基于上下文生成结构化中文初稿，包含标题、小节和结论。',
    buildPrompt: (body) => body.prompt || '请根据上下文生成一份结构化初稿。'
  }
}

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp'
}

function writeJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  })
  res.end(JSON.stringify(payload))
}

function sanitizeTitle(content = '') {
  const normalized = String(content).replace(/\s+/g, ' ').trim()
  return normalized.slice(0, 24) || '新对话'
}

async function readJsonBody(req) {
  return await new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', chunk => {
      raw += chunk
      if (raw.length > 1024 * 1024) {
        reject(new Error('Request body too large'))
        req.destroy()
      }
    })
    req.on('end', () => {
      if (!raw) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(raw))
      } catch {
        reject(new Error('Invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

async function fetchWebContext(targetUrl) {
  if (typeof targetUrl !== 'string' || !targetUrl.trim()) return null

  const normalizedUrl = targetUrl.trim()
  if (!/^https?:\/\//i.test(normalizedUrl)) {
    throw new Error('referenceUrl must start with http:// or https://')
  }

  const response = await fetch(normalizedUrl, {
    headers: {
      'User-Agent': 'HydroWebChat/1.0'
    }
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch reference URL (${response.status})`)
  }

  const html = await response.text()
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || normalizedUrl)
    .replace(/\s+/g, ' ')
    .trim()
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 12000)

  if (!text) {
    throw new Error('Reference URL content is empty after extraction')
  }

  return {
    url: normalizedUrl,
    title,
    content: text
  }
}

function buildUpstreamMessages(session, storedMessages, body = {}, webContext = null) {
  const messages = []
  if (session.systemPrompt) {
    messages.push({ role: 'system', content: session.systemPrompt })
  }

  if (webContext) {
    messages.push({
      role: 'system',
      content: `以下是用户提供的网页上下文，请优先基于该内容回答：\n标题：${webContext.title}\nURL：${webContext.url}\n内容：${webContext.content}`
    })
  }

  messages.push(...storedMessages.map(message => ({
    role: message.role,
    content: message.content
  })))

  if (typeof body.extraContext === 'string' && body.extraContext.trim()) {
    messages.push({
      role: 'system',
      content: `以下是用户补充的参考上下文：\n${body.extraContext.trim().slice(0, 12000)}`
    })
  }

  return messages
}

async function requestDeepSeek(messages, options = {}) {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) {
    throw new Error('Missing DEEPSEEK_API_KEY environment variable')
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: options.model || DEFAULT_MODEL,
        temperature: typeof options.temperature === 'number' ? options.temperature : 0.3,
        stream: false,
        messages
      }),
      signal: controller.signal
    })

    const text = await response.text()
    const data = JSON.parse(text)

    if (!response.ok) {
      const message = data?.error?.message || `DeepSeek request failed with status ${response.status}`
      const error = new Error(message)
      error.statusCode = response.status
      throw error
    }

    return {
      content: data?.choices?.[0]?.message?.content || '',
      usage: data?.usage || null
    }
  } finally {
    clearTimeout(timer)
  }
}

async function requestDeepSeekStream(messages, options = {}) {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) {
    throw new Error('Missing DEEPSEEK_API_KEY environment variable')
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: options.model || DEFAULT_MODEL,
        temperature: typeof options.temperature === 'number' ? options.temperature : 0.3,
        stream: true,
        messages
      }),
      signal: controller.signal
    })

    if (!response.ok || !response.body) {
      const text = await response.text()
      let message = `DeepSeek stream failed with status ${response.status}`
      try {
        const parsed = JSON.parse(text)
        message = parsed?.error?.message || message
      } catch {}
      const error = new Error(message)
      error.statusCode = response.status
      throw error
    }

    return { response, cleanup: () => clearTimeout(timer) }
  } catch (error) {
    clearTimeout(timer)
    throw error
  }
}

function resolveStaticPath(urlPathname) {
  const routeMap = new Map([
    ['/', 'index.html'],
    ['/workbench', 'pages/workbench/index.html'],
    ['/workbench/', 'pages/workbench/index.html'],
    ['/web-chat', 'pages/web-chat/index.html'],
    ['/web-chat/', 'pages/web-chat/index.html']
  ])

  const relativePath = routeMap.get(urlPathname) || urlPathname.replace(/^\/+/, '')
  const decodedPath = decodeURIComponent(relativePath)
  const absolutePath = path.resolve(DIST_DIR, decodedPath)
  if (!absolutePath.startsWith(DIST_DIR)) return null
  return absolutePath
}

async function serveStatic(req, res, pathname) {
  const filePath = resolveStaticPath(pathname)
  if (!filePath) {
    writeJson(res, 403, { success: false, error: 'Forbidden path' })
    return
  }

  let finalPath = filePath
  if (fs.existsSync(finalPath) && fs.statSync(finalPath).isDirectory()) {
    finalPath = path.join(finalPath, 'index.html')
  }

  if (!fs.existsSync(finalPath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Not found')
    return
  }

  const ext = path.extname(finalPath).toLowerCase()
  const mimeType = MIME_TYPES[ext] || 'application/octet-stream'
  res.writeHead(200, {
    'Content-Type': mimeType,
    'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=300'
  })
  fs.createReadStream(finalPath).pipe(res)
}

function persistUserMessage(session, body) {
  const content = typeof body.content === 'string' ? body.content.trim() : ''
  const userMessage = db.addMessage({
    sessionId: session.id,
    role: 'user',
    content,
    createdAt: new Date().toISOString()
  })

  const patch = {}
  if (typeof body.model === 'string' && body.model.trim()) {
    patch.model = body.model.trim()
  }
  if (typeof body.systemPrompt === 'string' && body.systemPrompt.trim()) {
    patch.systemPrompt = body.systemPrompt.trim()
  }
  if (db.getMessages(session.id).length === 1) {
    patch.title = sanitizeTitle(content)
  }
  db.updateSession(session.id, patch)

  return userMessage
}

async function streamToClient(upstreamResponse, res) {
  const reader = upstreamResponse.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let boundary = buffer.indexOf('\n\n')
    while (boundary !== -1) {
      const eventChunk = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)

      for (const line of eventChunk.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const payload = trimmed.slice(5).trim()
        if (!payload || payload === '[DONE]') continue

        try {
          const parsed = JSON.parse(payload)
          const delta = parsed?.choices?.[0]?.delta?.content || ''
          if (delta) {
            content += delta
            res.write(delta)
          }
        } catch {}
      }

      boundary = buffer.indexOf('\n\n')
    }
  }

  return content
}

async function handleStreamMessage(req, res, session, body) {
  const content = typeof body.content === 'string' ? body.content.trim() : ''
  if (!content) {
    writeJson(res, 400, { success: false, error: 'Message content is required' })
    return
  }

  const userMessage = persistUserMessage(session, body)
  const updatedSession = db.getSession(session.id)
  const storedMessages = db.getMessages(session.id)
  const webContext = body.referenceUrl ? await fetchWebContext(body.referenceUrl) : null
  const upstreamMessages = buildUpstreamMessages(updatedSession, storedMessages, body, webContext)

  let cleanup = null
  try {
    const upstream = await requestDeepSeekStream(upstreamMessages, {
      model: updatedSession.model,
      temperature: typeof body.temperature === 'number' ? body.temperature : 0.3
    })
    cleanup = upstream.cleanup

    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Session-Id': updatedSession.id,
      'X-User-Message-Id': userMessage.id
    })

    const assistantContent = await streamToClient(upstream.response, res)
    const assistantMessage = db.addMessage({
      sessionId: updatedSession.id,
      role: 'assistant',
      content: assistantContent,
      createdAt: new Date().toISOString()
    })
    db.updateSession(updatedSession.id, { updatedAt: assistantMessage.createdAt })
    res.end()
  } catch (error) {
    if (!res.headersSent) {
      writeJson(res, error.statusCode || 500, { success: false, error: error.message || 'DeepSeek request failed' })
    } else {
      res.write(`\n\n[ERROR] ${error.message || 'DeepSeek request failed'}`)
      res.end()
    }
  } finally {
    cleanup?.()
  }
}

async function handleNormalMessage(req, res, session, body) {
  const content = typeof body.content === 'string' ? body.content.trim() : ''
  if (!content) {
    writeJson(res, 400, { success: false, error: 'Message content is required' })
    return
  }

  const userMessage = persistUserMessage(session, body)
  const updatedSession = db.getSession(session.id)
  const storedMessages = db.getMessages(session.id)
  const webContext = body.referenceUrl ? await fetchWebContext(body.referenceUrl) : null
  const upstreamMessages = buildUpstreamMessages(updatedSession, storedMessages, body, webContext)

  try {
    const upstream = await requestDeepSeek(upstreamMessages, {
      model: updatedSession.model,
      temperature: typeof body.temperature === 'number' ? body.temperature : 0.3
    })
    const assistantMessage = db.addMessage({
      sessionId: updatedSession.id,
      role: 'assistant',
      content: upstream.content,
      usage: upstream.usage,
      createdAt: new Date().toISOString()
    })
    db.updateSession(updatedSession.id, { updatedAt: assistantMessage.createdAt })

    writeJson(res, 200, {
      success: true,
      data: {
        session: db.getSession(updatedSession.id),
        userMessage,
        assistantMessage,
        reference: webContext ? { title: webContext.title, url: webContext.url } : null
      }
    })
  } catch (error) {
    db.updateSession(updatedSession.id, { updatedAt: new Date().toISOString() })
    writeJson(res, error.statusCode || 500, {
      success: false,
      error: error.message || 'DeepSeek request failed'
    })
  }
}

async function handleApi(req, res, url) {
  const method = req.method || 'GET'
  const pathname = url.pathname

  if (pathname === '/api/workbench/overview' && method === 'GET') {
    writeJson(res, 200, {
      success: true,
      data: {
        provider: 'deepseek',
        defaultModel: DEFAULT_MODEL,
        sessionCount: db.countSessions(),
        messageCount: db.countMessages(),
        taskRunCount: db.countTaskRuns(),
        templates: Object.values(TASK_TEMPLATES)
      }
    })
    return
  }

  if (pathname === '/api/workbench/tasks' && method === 'GET') {
    writeJson(res, 200, {
      success: true,
      data: db.listTaskRuns(30)
    })
    return
  }

  if (pathname === '/api/workbench/tasks' && method === 'POST') {
    const body = await readJsonBody(req)
    const template = TASK_TEMPLATES[body.templateId] || TASK_TEMPLATES.summarize_page
    let session = null
    if (body.sessionId) {
      session = db.getSession(body.sessionId)
    }
    if (!session) {
      session = db.createSession({
        title: template.title,
        model: typeof body.model === 'string' && body.model.trim() ? body.model.trim() : DEFAULT_MODEL,
        systemPrompt: template.systemPrompt
      })
    }

    const prompt = template.buildPrompt(body)
    const taskRun = db.createTaskRun({
      sessionId: session.id,
      templateId: template.id,
      title: template.title,
      prompt,
      referenceUrl: typeof body.referenceUrl === 'string' ? body.referenceUrl.trim() : null
    })

    try {
      const syntheticBody = {
        content: prompt,
        model: body.model || session.model,
        systemPrompt: template.systemPrompt,
        referenceUrl: body.referenceUrl || '',
        extraContext: body.extraContext || ''
      }

      const userMessage = persistUserMessage(session, syntheticBody)
      const updatedSession = db.getSession(session.id)
      const storedMessages = db.getMessages(session.id)
      const webContext = syntheticBody.referenceUrl ? await fetchWebContext(syntheticBody.referenceUrl) : null
      const upstreamMessages = buildUpstreamMessages(updatedSession, storedMessages, syntheticBody, webContext)
      const upstream = await requestDeepSeek(upstreamMessages, {
        model: updatedSession.model,
        temperature: typeof body.temperature === 'number' ? body.temperature : 0.3
      })

      const assistantMessage = db.addMessage({
        sessionId: updatedSession.id,
        role: 'assistant',
        content: upstream.content,
        usage: upstream.usage,
        createdAt: new Date().toISOString()
      })
      db.updateSession(updatedSession.id, { updatedAt: assistantMessage.createdAt, title: updatedSession.title || template.title })
      db.updateTaskRun(taskRun.id, {
        status: 'completed',
        resultContent: assistantMessage.content,
        completedAt: assistantMessage.createdAt
      })

      writeJson(res, 200, {
        success: true,
        data: {
          taskRun: db.getTaskRun(taskRun.id),
          session: db.getSession(updatedSession.id),
          userMessage,
          assistantMessage,
          reference: webContext ? { title: webContext.title, url: webContext.url } : null
        }
      })
    } catch (error) {
      db.updateTaskRun(taskRun.id, {
        status: 'failed',
        resultContent: error.message || 'Task failed',
        completedAt: new Date().toISOString()
      })
      writeJson(res, error.statusCode || 500, {
        success: false,
        error: error.message || 'Task failed'
      })
    }
    return
  }

  if (pathname === '/api/health' && method === 'GET') {
    writeJson(res, 200, {
      success: true,
      data: {
        provider: 'deepseek',
        model: DEFAULT_MODEL,
        hasApiKey: Boolean(process.env.DEEPSEEK_API_KEY),
        sessionCount: db.countSessions(),
        taskRunCount: db.countTaskRuns()
      }
    })
    return
  }

  if (pathname === '/api/chat/sessions' && method === 'GET') {
    writeJson(res, 200, { success: true, data: db.listSessions() })
    return
  }

  if (pathname === '/api/chat/sessions' && method === 'POST') {
    const body = await readJsonBody(req)
    const session = db.createSession({
      title: '新对话',
      model: typeof body.model === 'string' && body.model.trim() ? body.model.trim() : DEFAULT_MODEL,
      systemPrompt: typeof body.systemPrompt === 'string' && body.systemPrompt.trim()
        ? body.systemPrompt.trim()
        : '你是 Hydro Web Chat 助手，请用简洁、准确的中文回答。'
    })
    writeJson(res, 200, { success: true, data: session })
    return
  }

  const streamMatch = pathname.match(/^\/api\/chat\/sessions\/([^/]+)\/messages\/stream$/)
  if (streamMatch) {
    const sessionId = decodeURIComponent(streamMatch[1])
    const session = db.getSession(sessionId)
    if (!session) {
      writeJson(res, 404, { success: false, error: 'Session not found' })
      return
    }
    if (method !== 'POST') {
      writeJson(res, 405, { success: false, error: 'Method not allowed' })
      return
    }
    const body = await readJsonBody(req)
    await handleStreamMessage(req, res, session, body)
    return
  }

  const sessionMatch = pathname.match(/^\/api\/chat\/sessions\/([^/]+)(?:\/messages)?$/)
  if (!sessionMatch) {
    writeJson(res, 404, { success: false, error: 'Route not found' })
    return
  }

  const sessionId = decodeURIComponent(sessionMatch[1])
  const session = db.getSession(sessionId)
  if (!session) {
    writeJson(res, 404, { success: false, error: 'Session not found' })
    return
  }

  if (pathname === `/api/chat/sessions/${encodeURIComponent(sessionId)}` && method === 'GET') {
    writeJson(res, 200, { success: true, data: session })
    return
  }

  if (pathname === `/api/chat/sessions/${encodeURIComponent(sessionId)}/messages` && method === 'GET') {
    writeJson(res, 200, { success: true, data: db.getMessages(sessionId) })
    return
  }

  if (pathname === `/api/chat/sessions/${encodeURIComponent(sessionId)}/messages` && method === 'POST') {
    const body = await readJsonBody(req)
    await handleNormalMessage(req, res, session, body)
    return
  }

  writeJson(res, 405, { success: false, error: 'Method not allowed' })
}

function createServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
    if (url.pathname.startsWith('/api/')) {
      handleApi(req, res, url).catch(error => {
        console.error('[WebChatServer] API failed:', error)
        writeJson(res, 500, { success: false, error: error.message || 'Internal server error' })
      })
      return
    }

    serveStatic(req, res, url.pathname).catch(error => {
      console.error('[WebChatServer] Static file failed:', error)
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('Internal server error')
      }
    })
  })
}

if (require.main === module) {
  if (!fs.existsSync(DIST_DIR)) {
    console.error('[WebChatServer] Build output not found. Please run `npm run build:vue` first.')
    process.exit(1)
  }

  const server = createServer()
  server.listen(PORT, HOST, () => {
    console.log(`[WebChatServer] Listening on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`)
  })
}

module.exports = {
  createServer
}
