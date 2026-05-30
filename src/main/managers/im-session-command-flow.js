async function activateNewSession({
  sessionId,
  wasActivated = false,
  pendingMessage,
  clearPendingMessage,
  notifyMessageReceived,
  replayPendingMessage,
  enqueueHello,
}) {
  if (!sessionId) return { ok: false }

  if (pendingMessage) {
    clearPendingMessage?.()
    await replayPendingMessage?.(pendingMessage)
    return { ok: true, mode: 'replay_pending' }
  }

  if (!wasActivated) {
    notifyMessageReceived?.()
    await enqueueHello?.()
    return { ok: true, mode: 'enqueue_hello' }
  }

  return { ok: true, mode: 'noop' }
}

function resolveResumeSelection({
  history,
  selectedIndex,
  currentSessionId,
  currentSession,
}) {
  const safeHistory = Array.isArray(history) ? history : []
  const index = Number.parseInt(selectedIndex, 10)
  if (Number.isNaN(index) || index < 1 || index > safeHistory.length) {
    return {
      action: 'invalid_index',
      max: safeHistory.length,
    }
  }

  const selected = safeHistory[index - 1]
  const selectedSessionId = selected?.session_id || selected?.sessionId || selected?.id || null
  if (currentSessionId && selectedSessionId === currentSessionId && currentSession?.queryGenerator) {
    return {
      action: 'already_connected',
      selected,
      sessionId: selectedSessionId,
    }
  }

  return {
    action: 'resume',
    selected,
    sessionId: selectedSessionId,
    index,
  }
}

module.exports = {
  activateNewSession,
  resolveResumeSelection,
}
