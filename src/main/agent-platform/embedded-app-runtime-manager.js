class EmbeddedAppRuntimeManager {
  constructor() {
    this.appStates = new Map()
  }

  _normalizeAppId(appId) {
    const normalized = typeof appId === 'string' ? appId.trim() : ''
    return normalized || 'embedded-app'
  }

  _normalizeClientId(clientId, appId) {
    const normalizedAppId = this._normalizeAppId(appId)
    const normalizedClientId = typeof clientId === 'string' ? clientId.trim() : ''
    return normalizedClientId || `embed:${normalizedAppId}`
  }

  _ensureAppState(appId) {
    const normalizedAppId = this._normalizeAppId(appId)
    if (!this.appStates.has(normalizedAppId)) {
      this.appStates.set(normalizedAppId, {
        context: null,
        commands: new Map()
      })
    }
    return this.appStates.get(normalizedAppId)
  }

  updateContext(appId, context = null) {
    const appState = this._ensureAppState(appId)
    appState.context = context && typeof context === 'object' ? context : null
    return appState.context
  }

  getContext(appId) {
    const appState = this.appStates.get(this._normalizeAppId(appId))
    return appState?.context || null
  }

  registerCommandClient(appId, clientId, invoke) {
    if (typeof invoke !== 'function') {
      throw new Error('Embedded app command invoke must be a function')
    }

    const normalizedAppId = this._normalizeAppId(appId)
    const normalizedClientId = this._normalizeClientId(clientId, normalizedAppId)
    const appState = this._ensureAppState(normalizedAppId)

    appState.commands.set(normalizedClientId, {
      clientId: normalizedClientId,
      invoke
    })

    return {
      appId: normalizedAppId,
      clientId: normalizedClientId
    }
  }

  unregisterCommandClient(appId, clientId) {
    const normalizedAppId = this._normalizeAppId(appId)
    const appState = this.appStates.get(normalizedAppId)
    if (!appState) return false

    const normalizedClientId = this._normalizeClientId(clientId, normalizedAppId)
    const removed = appState.commands.delete(normalizedClientId)

    if (!appState.context && appState.commands.size === 0) {
      this.appStates.delete(normalizedAppId)
    }

    return removed
  }

  async executeCommand(appId, command = null, payload = null, preferredClientId = null) {
    const normalizedAppId = this._normalizeAppId(appId)
    const appState = this.appStates.get(normalizedAppId)
    if (!appState || appState.commands.size === 0) {
      throw new Error(`Embedded app "${normalizedAppId}" command bridge is unavailable`)
    }

    const normalizedPreferredClientId = preferredClientId
      ? this._normalizeClientId(preferredClientId, normalizedAppId)
      : null

    const target = normalizedPreferredClientId && appState.commands.has(normalizedPreferredClientId)
      ? appState.commands.get(normalizedPreferredClientId)
      : appState.commands.values().next().value

    if (!target?.invoke) {
      throw new Error(`Embedded app "${normalizedAppId}" command bridge is unavailable`)
    }

    const result = await target.invoke({
      appId: normalizedAppId,
      clientId: target.clientId,
      command,
      payload: payload && typeof payload === 'object' ? payload : {}
    })

    return {
      appId: normalizedAppId,
      clientId: target.clientId,
      command,
      result: result == null ? null : result
    }
  }
}

module.exports = {
  EmbeddedAppRuntimeManager
}
