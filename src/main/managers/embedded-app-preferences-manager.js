function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeAppId(appId) {
  return normalizeString(appId)
}

function normalizeModelId(modelId) {
  return normalizeString(modelId) || null
}

class EmbeddedAppPreferencesManager {
  constructor(configManager) {
    this.configManager = configManager
  }

  _getRoot() {
    const config = this.configManager.getConfig()
    if (!config.settings) config.settings = {}
    if (!config.settings.embeddedApps) {
      config.settings.embeddedApps = { preferences: {} }
    } else if (!config.settings.embeddedApps.preferences || typeof config.settings.embeddedApps.preferences !== 'object') {
      config.settings.embeddedApps.preferences = {}
    }
    return config.settings.embeddedApps.preferences
  }

  getPreferences(appId) {
    const normalizedAppId = normalizeAppId(appId)
    if (!normalizedAppId) {
      return {
        appId: '',
        apiProfileId: null,
        modelId: null
      }
    }

    const preferences = this._getRoot()[normalizedAppId] || {}
    return {
      appId: normalizedAppId,
      apiProfileId: normalizeString(preferences.apiProfileId) || null,
      modelId: normalizeModelId(preferences.modelId)
    }
  }

  async updatePreferences(appId, updates = {}) {
    const normalizedAppId = normalizeAppId(appId)
    if (!normalizedAppId) {
      throw new Error('Embedded app id is required')
    }

    const root = this._getRoot()
    const current = this.getPreferences(normalizedAppId)
    const next = {
      appId: normalizedAppId,
      apiProfileId: updates.apiProfileId !== undefined
        ? (normalizeString(updates.apiProfileId) || null)
        : current.apiProfileId,
      modelId: updates.modelId !== undefined
        ? normalizeModelId(updates.modelId)
        : current.modelId
    }

    root[normalizedAppId] = {
      apiProfileId: next.apiProfileId,
      modelId: next.modelId
    }

    await this.configManager.save()
    return next
  }
}

module.exports = {
  EmbeddedAppPreferencesManager
}
