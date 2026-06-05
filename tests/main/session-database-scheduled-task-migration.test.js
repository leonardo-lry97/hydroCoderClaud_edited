import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => 'C:/tmp/cc-desktop-test')
  }
}))

function splitSqlList(value) {
  const items = []
  let current = ''
  let depth = 0
  let inSingleQuote = false
  let inDoubleQuote = false

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote
      current += char
      continue
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote
      current += char
      continue
    }

    if (!inSingleQuote && !inDoubleQuote) {
      if (char === '(') {
        depth += 1
      } else if (char === ')') {
        depth -= 1
      } else if (char === ',' && depth === 0) {
        const trimmed = current.trim()
        if (trimmed) items.push(trimmed)
        current = ''
        continue
      }
    }

    current += char
  }

  const trimmed = current.trim()
  if (trimmed) items.push(trimmed)
  return items
}

function parseCreateTable(sql) {
  const match = sql.match(/CREATE TABLE(?: IF NOT EXISTS)?\s+(\w+)\s*\(([\s\S]*)\)\s*$/i)
  if (!match) return null

  const [, tableName, body] = match
  const columns = splitSqlList(body)
    .filter(definition => !/^(PRIMARY KEY|FOREIGN KEY|UNIQUE|CONSTRAINT)\b/i.test(definition))
    .map((definition) => ({
      name: definition.trim().split(/\s+/)[0],
      definition: definition.trim()
    }))

  return { tableName, columns }
}

class FakeStatement {
  constructor(db, sql) {
    this.db = db
    this.sql = sql.trim()
  }

  all() {
    const pragmaMatch = this.sql.match(/^PRAGMA table_info\((\w+)\)$/i)
    if (pragmaMatch) {
      const table = this.db.tables.get(pragmaMatch[1])
      return table ? table.columns.map((column, index) => ({ cid: index, name: column.name })) : []
    }

    return []
  }

  get() {
    const tableSqlMatch = this.sql.match(/^SELECT sql FROM sqlite_master WHERE type='table' AND name='(\w+)'$/i)
    if (tableSqlMatch) {
      const table = this.db.tables.get(tableSqlMatch[1])
      return table ? { sql: table.sql } : undefined
    }

    return undefined
  }
}

class FakeDatabase {
  constructor() {
    this.tables = new Map()
    this.foreignKeys = []
  }

  prepare(sql) {
    return new FakeStatement(this, sql)
  }

  pragma(command) {
    this.foreignKeys.push(command)
    return null
  }

  exec(sql) {
    const statement = sql.trim()

    if (!statement) return this
    if (/^CREATE VIRTUAL TABLE\b/i.test(statement)) return this
    if (/^CREATE TRIGGER\b/i.test(statement)) return this
    if (/^(BEGIN TRANSACTION|COMMIT|ROLLBACK)$/i.test(statement)) return this

    if (/^CREATE TABLE\b/i.test(statement)) {
      this._createTable(statement)
      return this
    }

    const addColumnMatch = statement.match(/^ALTER TABLE\s+(\w+)\s+ADD COLUMN\s+(\w+)\s+([\s\S]+)$/i)
    if (addColumnMatch) {
      const [, tableName, columnName, columnType] = addColumnMatch
      const table = this.tables.get(tableName)
      if (table && !table.columns.some(column => column.name === columnName)) {
        table.columns.push({ name: columnName, definition: `${columnName} ${columnType.trim()}` })
        table.sql = this._buildCreateTableSql(tableName, table.columns)
      }
      return this
    }

    const renameTableMatch = statement.match(/^ALTER TABLE\s+(\w+)\s+RENAME TO\s+(\w+)$/i)
    if (renameTableMatch) {
      const [, oldName, newName] = renameTableMatch
      const table = this.tables.get(oldName)
      if (table) {
        this.tables.delete(oldName)
        this.tables.set(newName, {
          ...table,
          name: newName,
          sql: this._buildCreateTableSql(newName, table.columns)
        })
      }
      return this
    }

    const dropTableMatch = statement.match(/^DROP TABLE\s+(\w+)$/i)
    if (dropTableMatch) {
      this.tables.delete(dropTableMatch[1])
      return this
    }

    if (/^INSERT\b/i.test(statement)) {
      this._copyRows(statement)
      return this
    }

    const normalizeLegacyImTypesMatch = statement.match(
      /^UPDATE\s+agent_conversations\s+SET\s+type\s*=\s*'chat'\s+WHERE\s+type\s+IN\s*\(([\s\S]+)\)$/i
    )
    if (normalizeLegacyImTypesMatch) {
      const table = this.tables.get('agent_conversations')
      if (!table) return this

      const legacyTypes = splitSqlList(normalizeLegacyImTypesMatch[1])
        .map(value => value.trim().replace(/^'/, '').replace(/'$/, ''))

      table.rows = table.rows.map((row) => (
        legacyTypes.includes(row.type)
          ? { ...row, type: 'chat' }
          : row
      ))
      return this
    }

    return this
  }

  _createTable(sql) {
    const parsed = parseCreateTable(sql)
    if (!parsed) return

    const { tableName, columns } = parsed
    if (this.tables.has(tableName) && /CREATE TABLE IF NOT EXISTS/i.test(sql)) {
      return
    }

    this.tables.set(tableName, {
      name: tableName,
      columns,
      sql: this._buildCreateTableSql(tableName, columns),
      rows: []
    })
  }

  _copyRows(sql) {
    const match = sql.match(
      /^INSERT(?: OR IGNORE)? INTO\s+(\w+)\s*\(([\s\S]*?)\)\s*SELECT\s+([\s\S]+?)\s+FROM\s+(\w+)/i
    )
    if (!match) return

    const [, destinationName, destinationColumnsRaw, selectExpressionsRaw, sourceName] = match
    const destination = this.tables.get(destinationName)
    const source = this.tables.get(sourceName)
    if (!destination || !source) return

    const destinationColumns = splitSqlList(destinationColumnsRaw)
    const selectExpressions = splitSqlList(selectExpressionsRaw)

    destination.rows = source.rows.map((row) => {
      const nextRow = {}
      destinationColumns.forEach((columnName, index) => {
        nextRow[columnName] = this._evaluateSelectExpression(selectExpressions[index], row)
      })
      return nextRow
    })
  }

  _evaluateSelectExpression(expression, row) {
    const trimmed = expression.trim()
    const coalesceMatch = trimmed.match(/^COALESCE\((\w+),\s*'([^']*)'\)$/i)
    if (coalesceMatch) {
      const [, columnName, fallback] = coalesceMatch
      return row[columnName] ?? fallback
    }

    return row[trimmed]
  }

  _buildCreateTableSql(tableName, columns) {
    return `CREATE TABLE ${tableName} (${columns.map(column => column.definition).join(', ')})`
  }
}

describe('SessionDatabase scheduled task migration', () => {
  let SessionDatabase

  beforeEach(async () => {
    vi.resetModules()
    const module = await import('../../src/main/session-database.js')
    SessionDatabase = module.SessionDatabase
  })

  it('rebuilds legacy scheduled_tasks schema and removes compatibility columns', () => {
    const db = new SessionDatabase({
      userDataPath: 'C:/tmp/cc-desktop-test',
      Database: FakeDatabase
    })
    db.db = new FakeDatabase()

    db.db.exec(`
      CREATE TABLE scheduled_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL DEFAULT '',
        prompt TEXT NOT NULL DEFAULT '',
        cwd TEXT,
        api_profile_id TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        run_on_startup INTEGER NOT NULL DEFAULT 0,
        schedule_type TEXT NOT NULL DEFAULT 'interval',
        interval_minutes INTEGER,
        daily_time TEXT DEFAULT '',
        weekly_days TEXT DEFAULT '[]',
        first_run_mode TEXT NOT NULL DEFAULT 'next_slot',
        created_at INTEGER,
        updated_at INTEGER
      )
    `)

    db.db.tables.get('scheduled_tasks').rows.push({
      id: 3,
      name: 'legacy task',
      prompt: 'run',
      cwd: 'C:/workspace',
      api_profile_id: 'profile-1',
      enabled: 1,
      run_on_startup: 0,
      schedule_type: 'interval',
      interval_minutes: 30,
      daily_time: '',
      weekly_days: '[]',
      first_run_mode: 'next_slot',
      created_at: 100,
      updated_at: 200
    })

    db.createTables()
    db.runMigrations()

    const table = db.db.tables.get('scheduled_tasks')
    const columnNames = table.columns.map(column => column.name)

    expect(columnNames).not.toContain('run_on_startup')
    expect(columnNames).not.toContain('first_run_mode')
    expect(columnNames).toContain('model_id')
    expect(columnNames).toContain('max_runs')
    expect(columnNames).toContain('reset_count_on_enable')
    expect(columnNames).toContain('interval_anchor_mode')
    expect(columnNames).toContain('monthly_mode')
    expect(columnNames).toContain('monthly_day')
    expect(columnNames).toContain('first_run_at')

    expect(table.rows).toHaveLength(1)
    expect(table.rows[0]).toMatchObject({
      id: 3,
      name: 'legacy task',
      prompt: 'run',
      cwd: 'C:/workspace',
      api_profile_id: 'profile-1',
      enabled: 1,
      schedule_type: 'interval',
      interval_minutes: 30,
      created_at: 100,
      updated_at: 200
    })
  })

  it('creates scheduled tasks without legacy insert columns', () => {
    const db = new SessionDatabase({
      userDataPath: 'C:/tmp/cc-desktop-test',
      Database: FakeDatabase
    })

    let capturedSql = ''
    db.db = {
      prepare(sql) {
        capturedSql = sql
        return {
          run() {
            return { lastInsertRowid: 7 }
          }
        }
      }
    }
    db.ensureScheduledTaskState = vi.fn()
    db.getScheduledTask = vi.fn(() => ({ id: 7 }))

    const result = db.createScheduledTask({
      name: 'test task',
      prompt: 'do work',
      enabled: true,
      scheduleType: 'interval',
      intervalMinutes: 15
    })

    expect(capturedSql).toContain('INSERT INTO scheduled_tasks')
    expect(capturedSql).not.toContain('run_on_startup')
    expect(capturedSql).not.toContain('first_run_mode')
    expect(db.ensureScheduledTaskState).toHaveBeenCalledWith(7)
    expect(result).toEqual({ id: 7 })
  })

  it('rebuilds agent conversations and removes old IM identity columns', () => {
    const db = new SessionDatabase({
      userDataPath: 'C:/tmp/cc-desktop-test',
      Database: FakeDatabase
    })
    db.db = new FakeDatabase()

    db.db.exec(`
      CREATE TABLE agent_conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT UNIQUE NOT NULL,
        type TEXT NOT NULL DEFAULT 'chat',
        status TEXT NOT NULL DEFAULT 'idle',
        sdk_session_id TEXT,
        title TEXT NOT NULL DEFAULT '',
        cwd TEXT,
        cwd_auto INTEGER DEFAULT 0,
        message_count INTEGER DEFAULT 0,
        total_cost_usd REAL DEFAULT 0,
        api_profile_id TEXT,
        api_base_url TEXT,
        model_id TEXT,
        last_bootstrapped_runtime TEXT,
        pending_runtime_change INTEGER DEFAULT 0,
        queued_messages TEXT DEFAULT '[]',
        staff_id TEXT,
        conversation_id TEXT,
        im_user_id TEXT,
        im_chat_id TEXT,
        im_channel TEXT,
        im_chat_type TEXT,
        source TEXT DEFAULT 'manual',
        task_id INTEGER,
        owner_client_id TEXT,
        client_type TEXT,
        client_meta TEXT,
        created_at INTEGER,
        updated_at INTEGER
      )
    `)

    db.db.tables.get('agent_conversations').rows.push({
      id: 9,
      session_id: 'conv-9',
      type: 'chat',
      status: 'idle',
      sdk_session_id: 'sdk-9',
      title: '旧会话',
      cwd: 'C:/workspace',
      cwd_auto: 0,
      message_count: 2,
      total_cost_usd: 1.5,
      api_profile_id: 'profile-1',
      api_base_url: 'https://example.com',
      model_id: 'gpt-test',
      last_bootstrapped_runtime: 'desktop',
      pending_runtime_change: 0,
      queued_messages: '[]',
      staff_id: 'legacy-user',
      conversation_id: 'legacy-chat',
      im_user_id: 'user-a',
      im_chat_id: 'chat-a',
      im_channel: 'feishu',
      im_chat_type: 'p2p',
      source: 'im-inbound',
      task_id: null,
      owner_client_id: 'desktop-1',
      client_type: 'desktop',
      client_meta: '{}',
      created_at: 100,
      updated_at: 200
    })

    db.createTables()
    db.runMigrations()

    const table = db.db.tables.get('agent_conversations')
    const columnNames = table.columns.map(column => column.name)

    expect(columnNames).not.toContain('staff_id')
    expect(columnNames).not.toContain('conversation_id')
    expect(columnNames).toContain('im_user_id')
    expect(columnNames).toContain('im_chat_id')
    expect(columnNames).toContain('im_channel')
    expect(columnNames).toContain('im_chat_type')

    expect(table.rows).toHaveLength(1)
    expect(table.rows[0]).toMatchObject({
      id: 9,
      session_id: 'conv-9',
      title: '旧会话',
      im_user_id: 'user-a',
      im_chat_id: 'chat-a',
      im_channel: 'feishu',
      im_chat_type: 'p2p',
      source: 'im-inbound',
      created_at: 100,
      updated_at: 200
    })
    expect(table.rows[0]).not.toHaveProperty('staff_id')
    expect(table.rows[0]).not.toHaveProperty('conversation_id')
  })

  it('normalizes legacy IM channel types into chat', () => {
    const db = new SessionDatabase({
      userDataPath: 'C:/tmp/cc-desktop-test',
      Database: FakeDatabase
    })
    db.db = new FakeDatabase()

    db.db.exec(`
      CREATE TABLE agent_conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT UNIQUE NOT NULL,
        type TEXT NOT NULL DEFAULT 'chat',
        status TEXT NOT NULL DEFAULT 'idle',
        sdk_session_id TEXT,
        title TEXT NOT NULL DEFAULT '',
        cwd TEXT,
        cwd_auto INTEGER DEFAULT 0,
        message_count INTEGER DEFAULT 0,
        total_cost_usd REAL DEFAULT 0,
        api_profile_id TEXT,
        api_base_url TEXT,
        model_id TEXT,
        last_bootstrapped_runtime TEXT,
        pending_runtime_change TEXT DEFAULT 'unknown',
        queued_messages TEXT DEFAULT '[]',
        im_user_id TEXT,
        im_chat_id TEXT,
        im_channel TEXT,
        im_chat_type TEXT,
        source TEXT DEFAULT 'manual',
        task_id INTEGER,
        owner_client_id TEXT,
        client_type TEXT,
        client_meta TEXT,
        created_at INTEGER,
        updated_at INTEGER
      )
    `)

    db.db.tables.get('agent_conversations').rows.push(
      {
        id: 1,
        session_id: 'conv-dt',
        type: 'dingtalk',
        status: 'closed',
        title: '钉钉旧会话',
        source: 'im-inbound',
        created_at: 100,
        updated_at: 200
      },
      {
        id: 2,
        session_id: 'conv-fs',
        type: 'feishu',
        status: 'closed',
        title: '飞书旧会话',
        source: 'im-inbound',
        created_at: 110,
        updated_at: 210
      },
      {
        id: 3,
        session_id: 'conv-chat',
        type: 'chat',
        status: 'closed',
        title: '普通会话',
        source: 'manual',
        created_at: 120,
        updated_at: 220
      }
    )

    db.createTables()
    db.runMigrations()

    const table = db.db.tables.get('agent_conversations')

    expect(table.rows).toHaveLength(3)
    expect(table.rows.map(row => row.type)).toEqual(['chat', 'chat', 'chat'])
  })
})
