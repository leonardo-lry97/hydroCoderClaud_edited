function parseClientMeta(value) {
  if (!value) return null
  if (typeof value === 'object' && !Array.isArray(value)) return value
  if (typeof value !== 'string') return null
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function normalizeClient(client = {}) {
  return {
    clientId: typeof client.clientId === 'string' && client.clientId.trim()
      ? client.clientId.trim()
      : 'host-ui',
    clientType: typeof client.clientType === 'string' && client.clientType.trim()
      ? client.clientType.trim()
      : 'host',
    clientMeta: client.clientMeta && typeof client.clientMeta === 'object' && !Array.isArray(client.clientMeta)
      ? client.clientMeta
      : null
  }
}

class AgentSessionBroker {
  constructor(agentSessionManager) {
    this.agentSessionManager = agentSessionManager
  }

  _mergeEmbeddedClientMeta(sessionLike, client) {
    const normalizedClient = this._normalizeClient(client)
    const nextClientMeta = normalizedClient.clientMeta && typeof normalizedClient.clientMeta === 'object'
      ? normalizedClient.clientMeta
      : null

    if (sessionLike?.clientType !== 'embedded' || !nextClientMeta) {
      return sessionLike
    }

    const currentMeta = sessionLike.clientMeta && typeof sessionLike.clientMeta === 'object'
      ? sessionLike.clientMeta
      : null
    const currentAppId = currentMeta?.appId || currentMeta?.embeddedAppId || null
    const nextAppId = nextClientMeta?.appId || nextClientMeta?.embeddedAppId || null

    if (currentAppId && currentAppId === nextAppId) {
      return sessionLike
    }

    const mergedMeta = {
      ...(currentMeta || {}),
      ...nextClientMeta
    }

    if (sessionLike.id && this.agentSessionManager.sessionDatabase?.updateAgentConversation) {
      try {
        this.agentSessionManager.sessionDatabase.updateAgentConversation(sessionLike.id, {
          clientMeta: mergedMeta
        })
      } catch (err) {
        console.warn('[AgentSessionBroker] Failed to backfill embedded clientMeta:', {
          sessionId: sessionLike.id,
          error: err.message
        })
      }
    }

    if (this.agentSessionManager.sessions.has(sessionLike.id)) {
      const activeSession = this.agentSessionManager.sessions.get(sessionLike.id)
      activeSession.clientMeta = mergedMeta
    }

    return {
      ...sessionLike,
      clientMeta: mergedMeta
    }
  }

  _safeSend(...args) {
    return this.agentSessionManager._safeSend(...args)
  }

  _normalizeClient(client) {
    return normalizeClient(client)
  }

  _ownsSession(sessionLike, client) {
    const normalizedClient = this._normalizeClient(client)
    const ownerClientId = sessionLike?.ownerClientId || sessionLike?.owner_client_id || 'host-ui'
    return ownerClientId === normalizedClient.clientId
  }

  _loadPersistedSession(sessionId) {
    const row = this.agentSessionManager.sessionDatabase?.getAgentConversation?.(sessionId)
    if (!row) return null
    return {
      id: row.session_id,
      ownerClientId: row.owner_client_id || 'host-ui',
      clientType: row.client_type || 'host',
      clientMeta: parseClientMeta(row.client_meta)
    }
  }

  _assertOwnsSession(sessionId, client) {
    const activeSession = this.agentSessionManager.get(sessionId)
    const sessionLike = this._mergeEmbeddedClientMeta(
      activeSession || this._loadPersistedSession(sessionId),
      client
    )

    if (!sessionLike || !this._ownsSession(sessionLike, client)) {
      throw new Error('Session not found')
    }

    return sessionLike
  }

  getSessionOwnerClientId(sessionId) {
    const activeSession = this.agentSessionManager.get(sessionId)
    if (activeSession?.ownerClientId) return activeSession.ownerClientId
    return this._loadPersistedSession(sessionId)?.ownerClientId || null
  }

  create(options = {}, client) {
    const normalizedClient = this._normalizeClient(client)
    return this.agentSessionManager.create({
      ...options,
      ownerClientId: normalizedClient.clientId,
      clientType: normalizedClient.clientType,
      clientMeta: normalizedClient.clientMeta
    })
  }

  sendMessage(sessionId, message, options = {}, client) {
    this._assertOwnsSession(sessionId, client)
    return this.agentSessionManager.sendMessage(sessionId, message, options)
  }

  cancel(sessionId, client) {
    this._assertOwnsSession(sessionId, client)
    return this.agentSessionManager.cancel(sessionId)
  }

  reopen(sessionId, client) {
    this._assertOwnsSession(sessionId, client)
    return this.agentSessionManager.reopen(sessionId)
  }

  switchApiProfile(sessionId, profileId, client) {
    this._assertOwnsSession(sessionId, client)
    return this.agentSessionManager.switchApiProfile(sessionId, profileId)
  }

  close(sessionId, client) {
    this._assertOwnsSession(sessionId, client)
    return this.agentSessionManager.close(sessionId)
  }

  resolveInteraction(sessionId, interactionId, response, client) {
    this._assertOwnsSession(sessionId, client)
    return this.agentSessionManager.resolveInteraction(sessionId, interactionId, response)
  }

  cancelInteraction(sessionId, interactionId, reason, client) {
    this._assertOwnsSession(sessionId, client)
    return this.agentSessionManager.cancelInteraction(sessionId, interactionId, reason)
  }

  get(sessionId, client) {
    const session = this._mergeEmbeddedClientMeta(
      this.agentSessionManager.get(sessionId),
      client
    )
    return session && this._ownsSession(session, client) ? session : null
  }

  list(client) {
    return this.agentSessionManager.list()
      .map(session => this._mergeEmbeddedClientMeta(session, client))
      .filter(session => this._ownsSession(session, client))
  }

  rename(sessionId, title, client) {
    this._assertOwnsSession(sessionId, client)
    return this.agentSessionManager.rename(sessionId, title)
  }

  getMessages(sessionId, client) {
    this._assertOwnsSession(sessionId, client)
    return this.agentSessionManager.getMessages(sessionId)
  }

  compactConversation(sessionId, client) {
    this._assertOwnsSession(sessionId, client)
    return this.agentSessionManager.compactConversation(sessionId)
  }

  deleteConversation(sessionId, client) {
    this._assertOwnsSession(sessionId, client)
    return this.agentSessionManager.deleteConversation(sessionId)
  }

  clearAndRecreate(sessionId, overrides = {}, client) {
    this._assertOwnsSession(sessionId, client)
    return this.agentSessionManager.clearAndRecreate(sessionId, overrides)
  }

  syncEmbeddedCurrentSession(sessionId, client) {
    const sessionLike = this._assertOwnsSession(sessionId, client)
    return this._mergeEmbeddedClientMeta(sessionLike, client)
  }

  setModel(sessionId, model, client) {
    this._assertOwnsSession(sessionId, client)
    return this.agentSessionManager.setModel(sessionId, model)
  }

  getSupportedModels(sessionId, client) {
    this._assertOwnsSession(sessionId, client)
    return this.agentSessionManager.getSupportedModels(sessionId)
  }

  getSupportedCommands(sessionId, client) {
    this._assertOwnsSession(sessionId, client)
    return this.agentSessionManager.getSupportedCommands(sessionId)
  }

  getAccountInfo(sessionId, client) {
    this._assertOwnsSession(sessionId, client)
    return this.agentSessionManager.getAccountInfo(sessionId)
  }

  getMcpServerStatus(sessionId, client) {
    this._assertOwnsSession(sessionId, client)
    return this.agentSessionManager.getMcpServerStatus(sessionId)
  }

  getInitResult(sessionId, client) {
    this._assertOwnsSession(sessionId, client)
    return this.agentSessionManager.getInitResult(sessionId)
  }

  getOutputDir(sessionId, client) {
    this._assertOwnsSession(sessionId, client)
    return this.agentSessionManager.getOutputDir(sessionId)
  }

  listOutputFiles(sessionId, client) {
    this._assertOwnsSession(sessionId, client)
    return this.agentSessionManager.listOutputFiles(sessionId)
  }

  listDir(sessionId, relativePath = '', showHidden = false, client) {
    this._assertOwnsSession(sessionId, client)
    return this.agentSessionManager.listDir(sessionId, relativePath, showHidden)
  }

  readFile(sessionId, relativePath, client) {
    this._assertOwnsSession(sessionId, client)
    return this.agentSessionManager.readFile(sessionId, relativePath)
  }

  saveFile(sessionId, relativePath, content, client) {
    this._assertOwnsSession(sessionId, client)
    return this.agentSessionManager.saveFile(sessionId, relativePath, content)
  }

  searchFiles(sessionId, keyword, showHidden = false, client) {
    this._assertOwnsSession(sessionId, client)
    return this.agentSessionManager.searchFiles(sessionId, keyword, showHidden)
  }

  createFile(sessionId, parentPath, name, isDirectory, client) {
    this._assertOwnsSession(sessionId, client)
    return this.agentSessionManager.createFile(sessionId, parentPath, name, isDirectory)
  }

  renameFile(sessionId, oldPath, newName, client) {
    this._assertOwnsSession(sessionId, client)
    return this.agentSessionManager.renameFile(sessionId, oldPath, newName)
  }

  deleteFile(sessionId, relativePath, client) {
    this._assertOwnsSession(sessionId, client)
    return this.agentSessionManager.deleteFile(sessionId, relativePath)
  }
}

module.exports = { AgentSessionBroker, normalizeClient }
