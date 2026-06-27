const STORAGE_KEY = 'cc-desktop:web-demo-state'
const noop = () => {}

const isBrowser = typeof window !== 'undefined'

const defaultState = {
  settings: {
    theme: 'light',
    colorScheme: 'claude',
    locale: 'zh-CN',
    appMode: 'agent',
    enableDeveloperMode: true,
  },
  ui: {
    rightPanelWidth: '30.0%',
  },
  terminal: {
    fontSize: 14,
    fontFamily: 'Consolas, monospace',
    darkBackground: true,
  },
  providers: [
    {
      id: 'official',
      name: 'Anthropic Official',
      baseUrl: 'https://api.anthropic.com',
      defaultModels: ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5'],
    },
    {
      id: 'openai-compatible',
      name: 'OpenAI Compatible',
      baseUrl: 'https://api.openai.com/v1',
      defaultModels: ['gpt-4.1', 'gpt-4o-mini'],
    },
  ],
  apiProfiles: [
    {
      id: 'default-profile',
      name: 'Default Profile',
      icon: 'AI',
      isDefault: true,
      serviceProvider: 'official',
    },
  ],
  projects: [
    {
      id: 'demo-project',
      name: 'Hydro Web Demo',
      path: '/workspace/demo-project',
      pathValid: true,
      icon: '🌊',
      is_pinned: true,
      api_profile_id: 'default-profile',
    },
  ],
  activeSessions: [],
  historySessions: [],
}

const clone = (value) => JSON.parse(JSON.stringify(value))

const safeParse = (value, fallback) => {
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

const detectLocale = () => {
  if (!isBrowser) return defaultState.settings.locale
  const lang = (navigator.language || '').toLowerCase()
  return lang.startsWith('zh') ? 'zh-CN' : 'en-US'
}

const loadState = () => {
  if (!isBrowser) return clone(defaultState)
  const saved = safeParse(window.localStorage.getItem(STORAGE_KEY), null)
  return {
    ...clone(defaultState),
    ...saved,
    settings: {
      ...clone(defaultState).settings,
      locale: detectLocale(),
      ...(saved?.settings || {}),
    },
    ui: {
      ...clone(defaultState).ui,
      ...(saved?.ui || {}),
    },
    terminal: {
      ...clone(defaultState).terminal,
      ...(saved?.terminal || {}),
    },
    providers: Array.isArray(saved?.providers) ? saved.providers : clone(defaultState.providers),
    apiProfiles: Array.isArray(saved?.apiProfiles) ? saved.apiProfiles : clone(defaultState.apiProfiles),
    projects: Array.isArray(saved?.projects) ? saved.projects : clone(defaultState.projects),
    activeSessions: Array.isArray(saved?.activeSessions) ? saved.activeSessions : [],
    historySessions: Array.isArray(saved?.historySessions) ? saved.historySessions : [],
  }
}

let state = loadState()

const listeners = {
  settingsChanged: new Set(),
  updateAvailable: new Set(),
  updateInstallFailed: new Set(),
  capabilitiesUpdateAvailable: new Set(),
}

const saveState = () => {
  if (!isBrowser) return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

const emit = (channel, payload) => {
  for (const callback of listeners[channel] || []) {
    try {
      callback(payload)
    } catch (error) {
      console.error(`[web-api-adapter] listener failed for ${channel}:`, error)
    }
  }
}

const on = (channel, callback) => {
  listeners[channel]?.add(callback)
  return () => listeners[channel]?.delete(callback)
}

const demoUnsupported = (feature) => ({
  success: false,
  error: `${feature} is not available in the Vercel web demo.`,
  webDemo: true,
})

const mergeConfig = (patch = {}) => {
  state = {
    ...state,
    ...patch,
    settings: {
      ...state.settings,
      ...(patch.settings || {}),
    },
    ui: {
      ...state.ui,
      ...(patch.ui || {}),
    },
    terminal: {
      ...state.terminal,
      ...(patch.terminal || {}),
    },
  }
  saveState()
}

const guessFallbackValue = (methodName) => {
  if (/^on[A-Z]/.test(methodName)) return noop
  if (/list|:list$|Sessions|Projects|Providers|Profiles|Messages|Files|Prompts|Agents|Hooks|Skills|Tags|Targets/i.test(methodName)) {
    return []
  }
  if (/Status|Config|Settings|Routing|Detail|Info|Meta/i.test(methodName)) {
    return {}
  }
  if (/^is|^can|has/i.test(methodName)) {
    return false
  }
  if (/^getMax|Count|Limit/i.test(methodName)) {
    return 0
  }
  if (/open|create|update|save|delete|rename|sync|close|clear|write|broadcast|watch/i.test(methodName)) {
    return { success: true, webDemo: true }
  }
  return null
}

const buildElectronApi = () => {
  const explicitMethods = {
    bootstrap: {
      theme: state.settings.theme,
      colorScheme: state.settings.colorScheme,
      locale: state.settings.locale,
    },
    __webDemo: true,
    getConfig: async () => ({
      settings: clone(state.settings),
      ui: clone(state.ui),
    }),
    saveConfig: async (patch = {}) => {
      mergeConfig(patch)
      return { success: true, config: { settings: clone(state.settings), ui: clone(state.ui) } }
    },
    updateSettings: async (patch = {}) => {
      mergeConfig({ settings: patch })
      explicitMethods.bootstrap = {
        ...explicitMethods.bootstrap,
        ...patch,
      }
      emit('settingsChanged', clone(patch))
      return { success: true }
    },
    broadcastSettings: async (patch = {}) => {
      emit('settingsChanged', clone(patch))
      return { success: true }
    },
    onSettingsChanged: (callback) => on('settingsChanged', callback),
    getTerminalSettings: async () => clone(state.terminal),
    setMainWindowTitleByMode: async () => ({ success: true }),
    getUpdateStatus: async () => ({ hasUpdate: false }),
    onUpdateAvailable: (callback) => on('updateAvailable', callback),
    onUpdateInstallFailed: (callback) => on('updateInstallFailed', callback),
    getCapabilitiesUpdateStatus: async () => ({ hasUpdate: false }),
    onCapabilitiesUpdateAvailable: (callback) => on('capabilitiesUpdateAvailable', callback),
    clearCapabilitiesUpdateBadge: async () => ({ success: true }),
    listProviders: async () => clone(state.providers),
    listAPIProfiles: async () => clone(state.apiProfiles),
    getProjects: async () => clone(state.projects),
    touchProject: async () => ({ success: true }),
    checkPath: async () => ({ valid: true }),
    openProject: async () => demoUnsupported('Opening local projects'),
    openFolder: async () => ({ success: true }),
    toggleProjectPinned: async (projectId) => {
      state.projects = state.projects.map((project) => (
        project.id === projectId ? { ...project, is_pinned: !project.is_pinned } : project
      ))
      saveState()
      return { success: true }
    },
    hideProject: async (projectId) => {
      state.projects = state.projects.filter((project) => project.id !== projectId)
      saveState()
      return { success: true }
    },
    unhideProject: async () => ({ success: true }),
    createProject: async () => demoUnsupported('Creating projects from the browser'),
    updateProject: async ({ projectId, updates }) => {
      state.projects = state.projects.map((project) => (
        project.id === projectId ? { ...project, ...updates } : project
      ))
      saveState()
      return { success: true }
    },
    'embedded-app:list': async () => [],
    'embedded-app:open': async () => demoUnsupported('Embedded apps'),
    getActiveSession: async () => null,
    listActiveSessions: async () => clone(state.activeSessions),
    getProjectSessionsFromDb: async () => clone(state.historySessions),
    getMaxHistorySessions: async () => 10,
    getSessionLimits: async () => ({ runningCount: 0, maxSessions: 3 }),
    createActiveSession: async () => demoUnsupported('Terminal and agent sessions'),
    closeActiveSession: async () => ({ success: true }),
    renameActiveSession: async () => ({ success: true }),
    updateSessionTitle: async () => ({ success: true }),
    deleteSessionWithFile: async () => ({ success: true }),
    reopenAgentSession: async () => demoUnsupported('Reopening agent sessions'),
    clearAndRecreateAgentSession: async () => demoUnsupported('Clearing agent sessions'),
    getAgentSessionRouting: async () => null,
    getAgentSession: async () => null,
    readAbsolutePath: async () => demoUnsupported('Reading arbitrary files'),
    syncProjectSessions: async () => ({ success: true, synced: 0, webDemo: true }),
    getProjectConfigPath: async () => '/workspace/demo-project/.claude/settings.local.json',
    getClaudeSettingsPath: async () => '/workspace/demo-project/.claude/settings.json',
    openPath: async () => ({ success: true }),
    openProfileManager: async () => ({ success: true }),
    openModelSettings: async () => ({ success: true }),
    openGlobalSettings: async () => ({ success: true }),
    openSettingsWorkbench: async () => ({ success: true }),
    openAppearanceSettings: async () => ({ success: true }),
    openChannelSettings: async () => ({ success: true }),
    openUpdateManager: async () => ({ success: true }),
    notebookList: async () => [],
    notebookListTools: async () => [],
    notebookFetchRemoteTools: async () => ({ success: true, data: { tools: [] } }),
    notebookInstallTool: async () => demoUnsupported('Installing notebook tools'),
    notebookUninstallTool: async () => demoUnsupported('Uninstalling notebook tools'),
    notebookUpdateTool: async () => demoUnsupported('Editing notebook tools'),
    checkCapabilityInstalled: async () => 'not-installed',
    getMarketConfig: async () => ({ registryUrl: 'https://example.invalid/registry' }),
    previewMarketMcpConfig: async () => demoUnsupported('Previewing MCP market config'),
    watchSessionFiles: async () => ({ success: true }),
    stopWatchingSessionFiles: async () => ({ success: true }),
    onSessionStarted: () => noop,
    onSessionData: () => noop,
    onSessionExit: () => noop,
    onSessionError: () => noop,
    onSessionUpdated: () => noop,
    onSessionFileChanged: () => noop,
    onAgentRenamed: () => noop,
    onAgentStatusChange: () => noop,
    writeActiveSession: async () => demoUnsupported('Writing to shell sessions'),
  }

  return new Proxy(explicitMethods, {
    get(target, prop) {
      if (prop in target) return target[prop]
      if (typeof prop !== 'string') return undefined
      if (/^on[A-Z]/.test(prop)) {
        return () => noop
      }
      return async () => guessFallbackValue(prop)
    },
  })
}

export const isWebDemo = () => Boolean(isBrowser && window.electronAPI?.__webDemo)

export function ensureWebAdapter() {
  if (!isBrowser || window.electronAPI) return
  window.electronAPI = buildElectronApi()
}
