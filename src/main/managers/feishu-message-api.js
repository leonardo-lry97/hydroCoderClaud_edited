/**
 * 飞书消息 API 封装
 *
 * 通过 REST API 主动向飞书用户发送消息（桌面→飞书推送通道）。
 * 这是飞书桥接与钉钉桥接最关键的区别——飞书天然支持服务端主动推送。
 *
 * API 参考：https://open.feishu.cn/document/server-docs/im-v1/message/create
 */

const FEISHU_API_BASE = 'https://open.feishu.cn/open-apis'
const MAX_TEXT_LENGTH = 6000

class FeishuMessageAPI {
  constructor(opts = {}) {
    this._apiBase = opts.apiBase || FEISHU_API_BASE
    this._maxTextLength = opts.maxTextLength || MAX_TEXT_LENGTH
    this._accessToken = null
    this._tokenExpiresAt = 0
    this._appId = null
    this._appSecret = null
  }

  // ─── 配置 ───

  setCredentials(appId, appSecret) {
    this._appId = appId
    this._appSecret = appSecret
    this._accessToken = null
    this._tokenExpiresAt = 0
  }

  // ─── Token 管理 ───

  async getAccessToken() {
    if (this._accessToken && Date.now() < this._tokenExpiresAt) {
      return this._accessToken
    }
    return this._refreshToken()
  }

  /** @private */
  async _refreshToken() {
    if (!this._appId || !this._appSecret) {
      throw new Error('Feishu credentials not configured')
    }
    const resp = await globalThis.fetch(
      `${this._apiBase}/auth/v3/app_access_token/internal`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id: this._appId, app_secret: this._appSecret }),
      }
    )
    const data = await resp.json()
    if (data.code !== 0) {
      throw new Error(`Feishu token error: ${data.msg} (code=${data.code})`)
    }
    this._accessToken = data.app_access_token
    this._tokenExpiresAt = Date.now() + (data.expire - 300) * 1000
    return this._accessToken
  }

  // ─── 消息发送 ───

  /**
   * 发送文本消息
   * @param {'open_id'|'user_id'|'chat_id'} receiveIdType
   * @param {string} receiveId - 接收者 ID
   * @param {string} content - 文本内容
   * @returns {Promise<string|null>} message_id 或 null
   */
  async sendTextMessage(receiveIdType, receiveId, content) {
    const token = await this.getAccessToken()
    const text = typeof content === 'string' ? content : String(content)

    const contentJson = JSON.stringify({ text: this._truncate(text) })

    const resp = await globalThis.fetch(
      `${this._apiBase}/im/v1/messages?receive_id_type=${receiveIdType}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          receive_id: receiveId,
          msg_type: 'text',
          content: contentJson,
        }),
      }
    )
    const data = await resp.json()
    if (data.code !== 0) {
      throw new Error(`Feishu send failed: ${data.msg} (code=${data.code})`)
    }
    return data?.data?.message_id || null
  }

  /**
   * 获取指定消息的内容
   * @param {string} messageId
   * @returns {Promise<object|null>}
   */
  async getMessage(messageId) {
    const token = await this.getAccessToken()
    const resp = await globalThis.fetch(
      `${this._apiBase}/im/v1/messages/${encodeURIComponent(messageId)}`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      }
    )
    const data = await resp.json()
    if (data.code !== 0) {
      throw new Error(`Feishu get message failed: ${data.msg} (code=${data.code})`)
    }
    const item = data?.data?.items?.[0] || data?.data?.item || null
    if (!item) return null
    return {
      ...item,
      content: item?.content ?? item?.body?.content ?? null,
      mentions: Array.isArray(item?.mentions) ? item.mentions : [],
      msg_type: item?.msg_type || item?.message_type || null,
    }
  }

  async getUserInfo(userId) {
    const token = await this.getAccessToken()
    const resp = await globalThis.fetch(
      `${this._apiBase}/contact/v3/users/basic_batch?user_id_type=open_id`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({ user_ids: [userId] }),
      }
    )
    const data = await resp.json()
    if (data.code !== 0) {
      throw new Error(`Feishu get user failed: ${data.msg} (code=${data.code})`)
    }
    const user = Array.isArray(data?.data?.users) ? data.data.users[0] : (data?.data?.user || data?.data || null)
    return user
  }

  /**
   * 列出可发送的组织成员
   * @param {object} [options]
   * @param {number} [options.limit=200]
   * @param {number} [options.pageSize=50]
   * @param {string} [options.pageToken='']
   * @returns {Promise<Array<object>>}
   */
  async listUsers(options = {}) {
    const limit = Number.isFinite(options.limit) ? Math.max(1, Math.floor(options.limit)) : 200
    const pageSize = Math.min(Math.max(Number(options.pageSize) || 50, 1), 100)
    const rootDepartmentId = typeof options.departmentId === 'string' && options.departmentId.trim()
      ? options.departmentId.trim()
      : '0'
    const departmentIdType = typeof options.departmentIdType === 'string' && options.departmentIdType.trim()
      ? options.departmentIdType.trim()
      : 'open_department_id'
    const token = await this.getAccessToken()
    const users = []
    const seenOpenIds = new Set()
    const visitedDepartments = new Set()
    const queuedDepartments = new Set([rootDepartmentId])
    const departmentQueue = [rootDepartmentId]
    const requestJson = async (url, errorLabel) => {
      const resp = await globalThis.fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await resp.json()
      if (data.code !== 0) {
        throw new Error(`Feishu ${errorLabel} failed: ${data.msg} (code=${data.code})`)
      }
      return data
    }
    const extractBatch = (data) => {
      if (Array.isArray(data?.data?.items)) return data.data.items
      if (Array.isArray(data?.data?.users)) return data.data.users
      if (Array.isArray(data?.data?.departments)) return data.data.departments
      if (Array.isArray(data?.data)) return data.data
      return []
    }
    const nextPageToken = (data) => data?.data?.page_token || data?.data?.next_page_token || data?.data?.pageToken || ''
    const normalizeUser = (item) => {
      const openId = item?.open_id || item?.openId || item?.id || ''
      if (!openId) return null
      return {
        openId,
        userId: item?.user_id || item?.userId || null,
        name: item?.name || item?.display_name || item?.nickname || item?.user_name || item?.real_name || item?.en_name || '',
        displayName: item?.name || item?.display_name || item?.nickname || item?.user_name || item?.real_name || item?.en_name || openId,
        email: item?.email || null,
        departmentIds: Array.isArray(item?.department_ids) ? item.department_ids : (typeof item?.department_id === 'string' ? [item.department_id] : []),
        jobTitle: item?.job_title || item?.jobTitle || '',
        avatarUrl: item?.avatar?.avatar_72 || item?.avatar?.avatar_240 || item?.avatar_url || null,
      }
    }
    const enqueueDepartment = (item) => {
      const childDepartmentId = item?.open_department_id || item?.openDepartmentId || item?.department_id || item?.departmentId || item?.id || ''
      if (!childDepartmentId || visitedDepartments.has(childDepartmentId) || queuedDepartments.has(childDepartmentId)) {
        return
      }
      queuedDepartments.add(childDepartmentId)
      departmentQueue.push(childDepartmentId)
    }

    while (departmentQueue.length > 0 && users.length < limit) {
      const departmentId = departmentQueue.shift()
      if (!departmentId || visitedDepartments.has(departmentId)) {
        continue
      }
      visitedDepartments.add(departmentId)

      let userPageToken = departmentId === rootDepartmentId
        ? (typeof options.pageToken === 'string' ? options.pageToken : '')
        : ''
      do {
        const url = new URL(`${this._apiBase}/contact/v3/users/find_by_department`)
        url.searchParams.set('department_id', departmentId)
        url.searchParams.set('department_id_type', departmentIdType)
        url.searchParams.set('user_id_type', 'open_id')
        url.searchParams.set('page_size', String(Math.min(pageSize, limit - users.length)))
        if (userPageToken) {
          url.searchParams.set('page_token', userPageToken)
        }

        const data = await requestJson(url, 'list users by department')
        const batch = extractBatch(data)
        for (const item of batch) {
          const user = normalizeUser(item)
          if (!user || seenOpenIds.has(user.openId)) continue
          seenOpenIds.add(user.openId)
          users.push(user)
          if (users.length >= limit) break
        }
        userPageToken = nextPageToken(data)
      } while (userPageToken && users.length < limit)

      let childPageToken = ''
      do {
        const url = new URL(`${this._apiBase}/contact/v3/departments/${encodeURIComponent(departmentId)}/children`)
        url.searchParams.set('department_id_type', departmentIdType)
        url.searchParams.set('fetch_child', 'false')
        url.searchParams.set('page_size', String(pageSize))
        if (childPageToken) {
          url.searchParams.set('page_token', childPageToken)
        }

        const data = await requestJson(url, 'list child departments')
        const batch = extractBatch(data)
        for (const item of batch) {
          enqueueDepartment(item)
        }
        childPageToken = nextPageToken(data)
      } while (childPageToken)
    }

    return users
  }

  async getChatInfo(chatId) {
    const token = await this.getAccessToken()
    const resp = await globalThis.fetch(
      `${this._apiBase}/im/v1/chats/${encodeURIComponent(chatId)}`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      }
    )
    const data = await resp.json()
    if (data.code !== 0) {
      throw new Error(`Feishu get chat failed: ${data.msg} (code=${data.code})`)
    }
    const chat = data?.data?.chat || data?.data || null
    return chat
  }

  /**
   * 发送交互式卡片消息
   * @param {'open_id'|'chat_id'} receiveIdType
   * @param {string} receiveId
   * @param {object} card - 卡片 JSON
   */
  async sendCardMessage(receiveIdType, receiveId, card) {
    const token = await this.getAccessToken()
    const cardJson = typeof card === 'string' ? card : JSON.stringify(card)

    const resp = await globalThis.fetch(
      `${this._apiBase}/im/v1/messages?receive_id_type=${receiveIdType}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          receive_id: receiveId,
          msg_type: 'interactive',
          content: cardJson,
        }),
      }
    )
    const data = await resp.json()
    if (data.code !== 0) {
      throw new Error(`Feishu card send failed: ${data.msg} (code=${data.code})`)
    }
    return data?.data?.message_id || null
  }

  /**
   * 上传图片
   * @param {Buffer|string} source - 文件 buffer 或磁盘路径
   * @param {string} [imageType] - message|avatar（默认 message）
   * @returns {Promise<string>} image_key
   */
  async uploadImage(source, imageType = 'message') {
    const token = await this.getAccessToken()
    const fs = require('fs')
    const path = require('path')

    let buffer, fileName
    if (Buffer.isBuffer(source)) {
      buffer = source
      fileName = 'image.png'
    } else {
      buffer = fs.readFileSync(source)
      fileName = path.basename(source)
    }

    // 使用 fetch + FormData 上传
    // 飞书上传图片: POST /open-apis/im/v1/images
    const form = new FormData()
    form.append('image_type', imageType)
    form.append('image', new Blob([buffer], { type: 'application/octet-stream' }), fileName)

    const resp = await globalThis.fetch(
      `${this._apiBase}/im/v1/images`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: form,
      }
    )
    const data = await resp.json()
    if (data.code !== 0) {
      throw new Error(`Feishu image upload failed: ${data.msg}`)
    }
    return data?.data?.image_key || null
  }

  /**
   * 下载消息中的图片（获取 base64 数据）
   * GET /open-apis/im/v1/messages/{message_id}/resources/{file_key}?type=image
   * @param {string} imageKey - file_key
   * @param {string} messageId - 消息 ID
   * @returns {Promise<{base64: string, mediaType: string}>}
   */
  async downloadImage(imageKey, messageId) {
    const token = await this.getAccessToken()
    const url = `${this._apiBase}/im/v1/messages/${encodeURIComponent(messageId)}/resources/${encodeURIComponent(imageKey)}?type=image`
    console.log('[FeishuMessageAPI] Downloading image from:', url)

    const resp = await globalThis.fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!resp.ok) {
      const body = await resp.text().catch(() => '')
      throw new Error(`Feishu image download failed: HTTP ${resp.status} - ${body.substring(0, 200)}`)
    }

    const contentType = resp.headers.get('content-type') || 'image/jpeg'
    const mediaType = contentType.split(';')[0].trim() || 'image/jpeg'
    const buffer = Buffer.from(await resp.arrayBuffer())
    return { base64: buffer.toString('base64'), mediaType }
  }

  /**
   * 发送图片消息
   * @param {'open_id'|'chat_id'} receiveIdType
   * @param {string} receiveId
   * @param {string} imageKey - 已上传的 image_key
   */
  async sendImageMessage(receiveIdType, receiveId, imageKey) {
    const token = await this.getAccessToken()
    const contentJson = JSON.stringify({ image_key: imageKey })

    const resp = await globalThis.fetch(
      `${this._apiBase}/im/v1/messages?receive_id_type=${receiveIdType}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          receive_id: receiveId,
          msg_type: 'image',
          content: contentJson,
        }),
      }
    )
    const data = await resp.json()
    if (data.code !== 0) {
      throw new Error(`Feishu image send failed: ${data.msg}`)
    }
    return data?.data?.message_id || null
  }

  /**
   * 回复消息（在指定消息的线程中回复）
   * @param {string} msgId - 被回复的消息 ID
   * @param {string} content - 文本内容
   */
  async replyTextMessage(msgId, content) {
    const token = await this.getAccessToken()
    const contentJson = JSON.stringify({ text: this._truncate(content) })

    const resp = await globalThis.fetch(
      `${this._apiBase}/im/v1/messages/${msgId}/reply`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: contentJson,
          msg_type: 'text',
        }),
      }
    )
    const data = await resp.json()
    if (data.code !== 0) {
      throw new Error(`Feishu reply failed: ${data.msg}`)
    }
    return data?.data?.message_id || null
  }

  // ─── 辅助 ───

  /** @private */
  _truncate(text) {
    if (!text) return ''
    if (text.length <= this._maxTextLength) return text
    return text.substring(0, this._maxTextLength) + '\n\n...（内容过长，已截断）'
  }
}

module.exports = { FeishuMessageAPI }
