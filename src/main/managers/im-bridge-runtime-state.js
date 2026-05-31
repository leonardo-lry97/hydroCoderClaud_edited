function resolveBridgeRuntimeState({ enabled, connected, runtimeState, manualStopped } = {}) {
  if (!enabled) return 'disabled'
  if (connected) return 'connected'

  const normalized = typeof runtimeState === 'string' ? runtimeState.trim() : ''
  if (normalized === 'disabled') {
    return manualStopped ? 'manually_disconnected' : 'disconnected'
  }
  if (normalized) return normalized
  if (manualStopped) return 'manually_disconnected'
  return 'disconnected'
}

function buildBridgeStatus({
  enabled,
  connected,
  activeSessions = 0,
  runtimeState,
  manualStopped = false,
} = {}) {
  return {
    enabled: !!enabled,
    connected: !!connected,
    activeSessions: Number.isFinite(activeSessions) ? activeSessions : 0,
    manualStopped: !!manualStopped,
    runtimeState: resolveBridgeRuntimeState({
      enabled,
      connected,
      runtimeState,
      manualStopped,
    }),
  }
}

function runtimeStateFromStopReason(reason) {
  if (reason === 'disabled') return 'disabled'
  if (reason === 'manual') return 'manually_disconnected'
  return 'disconnected'
}

module.exports = {
  buildBridgeStatus,
  resolveBridgeRuntimeState,
  runtimeStateFromStopReason,
}
