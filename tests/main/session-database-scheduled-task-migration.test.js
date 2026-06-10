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

  run(...params) {
    const insertMatch = this.sql.match(/^INSERT INTO\s+(\w+)\s*\(([\s\S]*?)\)\s*VALUES\s*\(([\s\S]*?)\)$/i)
    if (insertMatch) {
      const [, tableName, columnsRaw] = insertMatch
      const table = this.db.tables.get(tableName)
      if (!table) return { lastInsertRowid: null, changes: 0 }

      const columns = splitSqlList(columnsRaw)
      const row = {}
      columns.forEach((columnName, index) => {
        row[columnName] = params[index]
      })
      table.rows.push(row)
      return { lastInsertRowid: table.rows.length, changes: 1 }
    }

    return { lastInsertRowid: null, changes: 0 }
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

    const selectCountMatch = this.sql.match(/^SELECT COUNT\(\*\) AS count FROM (\w+) WHERE (.+)$/i)
    if (selectCountMatch) {
      const [, tableName, whereClause] = selectCountMatch
      const table = this.db.tables.get(tableName)
      if (!table) return { count: 0 }
      const count = table.rows.filter(row => this.db._matchesWhereClause(row, whereClause)).length
      return { count }
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

    const updateMatch = statement.match(/^UPDATE\s+(\w+)\s+SET\s+([\s\S]+?)(?:\s+WHERE\s+([\s\S]+))?$/i)
    if (updateMatch) {
      const [, tableName, assignmentsRaw, whereClause] = updateMatch
      const table = this.tables.get(tableName)
      if (!table) return this

      const assignments = splitSqlList(assignmentsRaw)
      table.rows = table.rows.map((row) => {
        if (whereClause && !this._matchesWhereClause(row, whereClause)) return row

        const nextRow = { ...row }
        assignments.forEach((assignment) => {
          const [, columnName, expression] = assignment.match(/^(\w+)\s*=\s*([\s\S]+)$/) || []
          if (!columnName) return
          nextRow[columnName] = this._evaluateSelectExpression(expression, row)
        })
        return nextRow
      })
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
    const caseMatch = trimmed.match(/^CASE\s+([\s\S]+?)\s+END$/i)
    if (caseMatch) {
      const body = caseMatch[1]
      const whenRegex = /WHEN\s+([\s\S]+?)\s+THEN\s+([\s\S]+?)(?=\s+WHEN|\s+ELSE|$)/gi
      let match
      while ((match = whenRegex.exec(body))) {
        const [, condition, resultExpression] = match
        if (this._matchesWhereClause(row, condition)) {
          return this._evaluateSelectExpression(resultExpression, row)
        }
      }

      const elseMatch = body.match(/\sELSE\s+([\s\S]+)$/i)
      if (elseMatch) {
        return this._evaluateSelectExpression(elseMatch[1], row)
      }
      return null
    }

    const coalesceMatch = trimmed.match(/^COALESCE\((\w+),\s*'([^']*)'\)$/i)
    if (coalesceMatch) {
      const [, columnName, fallback] = coalesceMatch
      return row[columnName] ?? fallback
    }

    if (/^NULL$/i.test(trimmed)) return null
    if (/^''$/.test(trimmed)) return ''

    const quotedStringMatch = trimmed.match(/^'([\s\S]*)'$/)
    if (quotedStringMatch) return quotedStringMatch[1]

    return row[trimmed]
  }

  _matchesWhereClause(row, clause) {
    return clause
      .split(/\s+AND\s+/i)
      .every(condition => this._evaluateCondition(row, condition.trim()))
  }

  _evaluateCondition(row, condition) {
    if (!condition) return true

    const wrapped = condition.replace(/^\(([\s\S]+)\)$/, '$1').trim()

    const inMatch = wrapped.match(/^(\w+)\s+IN\s*\(([\s\S]+)\)$/i)
    if (inMatch) {
      const [, columnName, valuesRaw] = inMatch
      const values = splitSqlList(valuesRaw).map(value => this._evaluateSelectExpression(value, row))
      return values.includes(row[columnName])
    }

    const coalesceNeMatch = wrapped.match(/^COALESCE\((\w+),\s*'([^']*)'\)\s*<>\s*'([^']*)'$/i)
    if (coalesceNeMatch) {
      const [, columnName, fallback, expected] = coalesceNeMatch
      return (row[columnName] ?? fallback) !== expected
    }

    const coalesceEqMatch = wrapped.match(/^COALESCE\((\w+),\s*'([^']*)'\)\s*=\s*'([^']*)'$/i)
    if (coalesceEqMatch) {
      const [, columnName, fallback, expected] = coalesceEqMatch
      return (row[columnName] ?? fallback) === expected
    }

    const compareMatch = wrapped.match(/^(\w+)\s*(=|<>|!=)\s*(.+)$/)
    if (compareMatch) {
      const [, columnName, operator, valueExpression] = compareMatch
      const left = row[columnName]
      const right = this._evaluateSelectExpression(valueExpression, row)
      if (operator === '=' ) return left === right
      return left !== right
    }

    return false
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

  it('migrates legacy IM identity rows into the canonical IM fields', () => {
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
        source TEXT DEFAULT 'manual',
        created_at INTEGER,
        updated_at INTEGER
      )
    `)

    db.db.tables.get('agent_conversations').rows.push(
      {
        id: 1,
        session_id: 'dt-p2p',
        type: 'dingtalk',
        status: 'closed',
        title: '钉钉单聊',
        staff_id: 'staff-1',
        conversation_id: '',
        source: 'im-inbound',
        created_at: 100,
        updated_at: 200
      },
      {
        id: 2,
        session_id: 'dt-group',
        type: 'dingtalk',
        status: 'closed',
        title: '钉钉群聊',
        staff_id: 'staff-2',
        conversation_id: 'conv-group-1',
        source: 'im-inbound',
        created_at: 110,
        updated_at: 210
      },
      {
        id: 3,
        session_id: 'fs-p2p',
        type: 'chat',
        status: 'closed',
        title: '飞书单聊',
        staff_id: 'ou-user-1',
        conversation_id: '',
        source: 'feishu',
        created_at: 120,
        updated_at: 220
      },
      {
        id: 4,
        session_id: 'fs-group',
        type: 'chat',
        status: 'closed',
        title: '飞书群聊',
        staff_id: 'ou-user-2',
        conversation_id: 'oc-group-1',
        source: 'feishu',
        created_at: 130,
        updated_at: 230
      },
      {
        id: 5,
        session_id: 'wx-p2p',
        type: 'weixin',
        status: 'closed',
        title: '微信单聊',
        staff_id: 'wx-user-1',
        conversation_id: 'wx-account-legacy',
        source: 'im-inbound',
        created_at: 140,
        updated_at: 240
      }
    )

    db.createTables()
    db.runMigrations()

    const rows = db.db.tables.get('agent_conversations').rows

    expect(rows).toHaveLength(5)
    expect(rows.find(row => row.session_id === 'dt-p2p')).toMatchObject({
      type: 'chat',
      im_channel: 'dingtalk',
      im_user_id: 'staff-1',
      im_chat_id: '',
      im_chat_type: 'p2p'
    })
    expect(rows.find(row => row.session_id === 'dt-group')).toMatchObject({
      type: 'chat',
      im_channel: 'dingtalk',
      im_user_id: '',
      im_chat_id: 'conv-group-1',
      im_chat_type: 'group'
    })
    expect(rows.find(row => row.session_id === 'fs-p2p')).toMatchObject({
      type: 'chat',
      im_channel: 'feishu',
      im_user_id: 'ou-user-1',
      im_chat_id: '',
      im_chat_type: 'p2p'
    })
    expect(rows.find(row => row.session_id === 'fs-group')).toMatchObject({
      type: 'chat',
      im_channel: 'feishu',
      im_user_id: '',
      im_chat_id: 'oc-group-1',
      im_chat_type: 'group'
    })
    expect(rows.find(row => row.session_id === 'wx-p2p')).toMatchObject({
      type: 'chat',
      im_channel: 'weixin',
      im_user_id: 'wx-user-1',
      im_chat_id: '',
      im_chat_type: 'p2p'
    })
  })

  it('keeps existing canonical IM identity fields when legacy columns also exist', () => {
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
        staff_id TEXT,
        conversation_id TEXT,
        im_user_id TEXT,
        im_chat_id TEXT,
        im_channel TEXT,
        im_chat_type TEXT,
        source TEXT DEFAULT 'manual',
        created_at INTEGER,
        updated_at INTEGER
      )
    `)

    db.db.tables.get('agent_conversations').rows.push({
      id: 6,
      session_id: 'mixed-era',
      type: 'dingtalk',
      status: 'closed',
      title: '混合时代数据',
      staff_id: 'legacy-user',
      conversation_id: 'legacy-chat',
      im_user_id: 'ou-kept',
      im_chat_id: 'oc-kept',
      im_channel: 'feishu',
      im_chat_type: 'p2p',
      source: 'im-inbound',
      created_at: 150,
      updated_at: 250
    })

    db.createTables()
    db.runMigrations()

    const row = db.db.tables.get('agent_conversations').rows[0]
    expect(row).toMatchObject({
      type: 'chat',
      im_channel: 'feishu',
      im_user_id: 'ou-kept',
      im_chat_id: 'oc-kept',
      im_chat_type: 'p2p'
    })
  })

  it('creates new agent conversation tables with the final IM field set', () => {
    const db = new SessionDatabase({
      userDataPath: 'C:/tmp/cc-desktop-test',
      Database: FakeDatabase
    })
    db.db = new FakeDatabase()

    db.createTables()

    const table = db.db.tables.get('agent_conversations')
    const columnNames = table.columns.map(column => column.name)

    expect(columnNames).toContain('im_user_id')
    expect(columnNames).toContain('im_chat_id')
    expect(columnNames).toContain('im_channel')
    expect(columnNames).toContain('im_chat_type')
    expect(columnNames).not.toContain('staff_id')
    expect(columnNames).not.toContain('conversation_id')
  })

  it('keeps historical cwd and cwd_auto unchanged during IM identity migration', () => {
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
        source TEXT DEFAULT 'manual',
        created_at INTEGER,
        updated_at INTEGER
      )
    `)

    db.db.tables.get('agent_conversations').rows.push({
      id: 7,
      session_id: 'legacy-cwd',
      type: 'feishu',
      status: 'closed',
      title: '历史工作目录会话',
      cwd: 'C:/legacy-root/feishu/conv-legacy-cwd',
      cwd_auto: 0,
      staff_id: 'ou-legacy',
      conversation_id: '',
      source: 'im-inbound',
      created_at: 160,
      updated_at: 260
    })

    db.createTables()
    db.runMigrations()

    const row = db.db.tables.get('agent_conversations').rows[0]
    expect(row).toMatchObject({
      session_id: 'legacy-cwd',
      cwd: 'C:/legacy-root/feishu/conv-legacy-cwd',
      cwd_auto: 0,
      im_channel: 'feishu',
      im_user_id: 'ou-legacy',
      im_chat_id: '',
      im_chat_type: 'p2p'
    })
  })
})
