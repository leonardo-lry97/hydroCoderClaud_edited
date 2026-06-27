const fs = require('fs')
const path = require('path')
const { randomUUID } = require('crypto')
const { DatabaseSync } = require('node:sqlite')

class WebChatDatabase {
  constructor(options = {}) {
    this.dataDir = options.dataDir || path.resolve(process.cwd(), '.web-chat-data')
    this.dbPath = path.join(this.dataDir, 'web-chat.sqlite')
    fs.mkdirSync(this.dataDir, { recursive: true })
    this.db = new DatabaseSync(this.dbPath)
    this.db.exec('PRAGMA journal_mode = WAL;')
    this.db.exec('PRAGMA foreign_keys = ON;')
    this._init()
  }

  _init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chat_sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        model TEXT NOT NULL,
        system_prompt TEXT DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS chat_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        usage_json TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_chat_messages_session
      ON chat_messages(session_id, created_at);

      CREATE TABLE IF NOT EXISTS chat_task_runs (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        template_id TEXT NOT NULL,
        title TEXT NOT NULL,
        prompt TEXT NOT NULL,
        reference_url TEXT,
        result_content TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        completed_at TEXT,
        FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_chat_task_runs_created
      ON chat_task_runs(created_at DESC);
    `)
  }

  countSessions() {
    return this.db.prepare('SELECT COUNT(*) AS count FROM chat_sessions').get()?.count || 0
  }

  countMessages() {
    return this.db.prepare('SELECT COUNT(*) AS count FROM chat_messages').get()?.count || 0
  }

  countTaskRuns() {
    return this.db.prepare('SELECT COUNT(*) AS count FROM chat_task_runs').get()?.count || 0
  }

  createSession({ title = '新对话', model, systemPrompt }) {
    const now = new Date().toISOString()
    const session = {
      id: randomUUID(),
      title,
      model,
      systemPrompt,
      createdAt: now,
      updatedAt: now
    }

    this.db.prepare(`
      INSERT INTO chat_sessions (id, title, model, system_prompt, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      session.id,
      session.title,
      session.model,
      session.systemPrompt,
      session.createdAt,
      session.updatedAt
    )

    return session
  }

  listSessions() {
    return this.db.prepare(`
      SELECT
        s.id,
        s.title,
        s.model,
        s.created_at AS createdAt,
        s.updated_at AS updatedAt,
        COUNT(m.id) AS messageCount
      FROM chat_sessions s
      LEFT JOIN chat_messages m ON m.session_id = s.id
      GROUP BY s.id
      ORDER BY s.updated_at DESC
    `).all()
  }

  getSession(sessionId) {
    return this.db.prepare(`
      SELECT
        id,
        title,
        model,
        system_prompt AS systemPrompt,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM chat_sessions
      WHERE id = ?
    `).get(sessionId) || null
  }

  updateSession(sessionId, patch = {}) {
    const existing = this.getSession(sessionId)
    if (!existing) return null

    const next = {
      ...existing,
      ...patch,
      updatedAt: patch.updatedAt || new Date().toISOString()
    }

    this.db.prepare(`
      UPDATE chat_sessions
      SET title = ?, model = ?, system_prompt = ?, updated_at = ?
      WHERE id = ?
    `).run(
      next.title,
      next.model,
      next.systemPrompt,
      next.updatedAt,
      sessionId
    )

    return this.getSession(sessionId)
  }

  addMessage({ sessionId, role, content, usage = null, createdAt = new Date().toISOString() }) {
    const message = {
      id: randomUUID(),
      sessionId,
      role,
      content,
      usage,
      createdAt
    }

    this.db.prepare(`
      INSERT INTO chat_messages (id, session_id, role, content, usage_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      message.id,
      message.sessionId,
      message.role,
      message.content,
      message.usage ? JSON.stringify(message.usage) : null,
      message.createdAt
    )

    return message
  }

  getMessages(sessionId) {
    return this.db.prepare(`
      SELECT
        id,
        session_id AS sessionId,
        role,
        content,
        usage_json AS usageJson,
        created_at AS createdAt
      FROM chat_messages
      WHERE session_id = ?
      ORDER BY created_at ASC, id ASC
    `).all(sessionId).map((row) => ({
      id: row.id,
      sessionId: row.sessionId,
      role: row.role,
      content: row.content,
      usage: row.usageJson ? JSON.parse(row.usageJson) : null,
      createdAt: row.createdAt
    }))
  }

  createTaskRun({ sessionId = null, templateId, title, prompt, referenceUrl = null }) {
    const now = new Date().toISOString()
    const taskRun = {
      id: randomUUID(),
      sessionId,
      templateId,
      title,
      prompt,
      referenceUrl,
      status: 'running',
      createdAt: now,
      completedAt: null,
      resultContent: null
    }

    this.db.prepare(`
      INSERT INTO chat_task_runs (
        id, session_id, template_id, title, prompt, reference_url,
        result_content, status, created_at, completed_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      taskRun.id,
      taskRun.sessionId,
      taskRun.templateId,
      taskRun.title,
      taskRun.prompt,
      taskRun.referenceUrl,
      taskRun.resultContent,
      taskRun.status,
      taskRun.createdAt,
      taskRun.completedAt
    )

    return taskRun
  }

  updateTaskRun(taskRunId, patch = {}) {
    const existing = this.getTaskRun(taskRunId)
    if (!existing) return null

    const next = {
      ...existing,
      ...patch
    }

    this.db.prepare(`
      UPDATE chat_task_runs
      SET session_id = ?, template_id = ?, title = ?, prompt = ?, reference_url = ?,
          result_content = ?, status = ?, created_at = ?, completed_at = ?
      WHERE id = ?
    `).run(
      next.sessionId,
      next.templateId,
      next.title,
      next.prompt,
      next.referenceUrl,
      next.resultContent,
      next.status,
      next.createdAt,
      next.completedAt,
      taskRunId
    )

    return this.getTaskRun(taskRunId)
  }

  getTaskRun(taskRunId) {
    return this.db.prepare(`
      SELECT
        id,
        session_id AS sessionId,
        template_id AS templateId,
        title,
        prompt,
        reference_url AS referenceUrl,
        result_content AS resultContent,
        status,
        created_at AS createdAt,
        completed_at AS completedAt
      FROM chat_task_runs
      WHERE id = ?
    `).get(taskRunId) || null
  }

  listTaskRuns(limit = 20) {
    return this.db.prepare(`
      SELECT
        id,
        session_id AS sessionId,
        template_id AS templateId,
        title,
        prompt,
        reference_url AS referenceUrl,
        result_content AS resultContent,
        status,
        created_at AS createdAt,
        completed_at AS completedAt
      FROM chat_task_runs
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit)
  }
}

module.exports = {
  WebChatDatabase
}
