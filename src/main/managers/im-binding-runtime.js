function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function registerImRuntimeTarget({
  sessionTargets,
  targetSessionMap,
  sessionId,
  targetId,
  target,
  getTargetId = (item) => item?.targetId,
  onReplaceSessionTarget,
  onReplaceTargetSession,
} = {}) {
  const resolvedSessionId = normalizeString(sessionId)
  const resolvedTargetId = normalizeString(targetId)
  if (!sessionTargets || !targetSessionMap || !resolvedSessionId || !resolvedTargetId || !target) {
    return { previousTarget: null, previousSessionId: null }
  }

  const previousTarget = sessionTargets.get(resolvedSessionId) || null
  const previousTargetId = normalizeString(getTargetId(previousTarget))
  if (previousTargetId && previousTargetId !== resolvedTargetId) {
    targetSessionMap.delete(previousTargetId)
    if (typeof onReplaceSessionTarget === 'function') {
      onReplaceSessionTarget({
        sessionId: resolvedSessionId,
        previousTarget,
        previousTargetId,
        nextTargetId: resolvedTargetId,
      })
    }
  }

  const previousSessionId = normalizeString(targetSessionMap.get(resolvedTargetId))
  if (previousSessionId && previousSessionId !== resolvedSessionId) {
    const previousSessionTarget = sessionTargets.get(previousSessionId) || null
    const previousSessionTargetId = normalizeString(getTargetId(previousSessionTarget)) || resolvedTargetId
    if (previousSessionTargetId) {
      targetSessionMap.delete(previousSessionTargetId)
    }
    sessionTargets.delete(previousSessionId)
    if (typeof onReplaceTargetSession === 'function') {
      onReplaceTargetSession({
        previousSessionId,
        previousSessionTarget,
        previousSessionTargetId,
        targetId: resolvedTargetId,
        nextSessionId: resolvedSessionId,
      })
    }
  }

  sessionTargets.set(resolvedSessionId, target)
  targetSessionMap.set(resolvedTargetId, resolvedSessionId)

  return { previousTarget, previousSessionId: previousSessionId || null }
}

function clearImRuntimeSessionTarget({
  sessionTargets,
  targetSessionMap,
  sessionId,
  getTargetId = (item) => item?.targetId,
} = {}) {
  const resolvedSessionId = normalizeString(sessionId)
  if (!sessionTargets || !targetSessionMap || !resolvedSessionId) return null

  const target = sessionTargets.get(resolvedSessionId) || null
  const targetId = normalizeString(getTargetId(target))
  if (targetId && targetSessionMap.get(targetId) === resolvedSessionId) {
    targetSessionMap.delete(targetId)
  }
  sessionTargets.delete(resolvedSessionId)
  return target
}

function clearImRuntimeTargetSession({
  sessionTargets,
  targetSessionMap,
  targetId,
} = {}) {
  const resolvedTargetId = normalizeString(targetId)
  if (!sessionTargets || !targetSessionMap || !resolvedTargetId) return null

  const sessionId = normalizeString(targetSessionMap.get(resolvedTargetId))
  targetSessionMap.delete(resolvedTargetId)
  if (sessionId) {
    sessionTargets.delete(sessionId)
  }
  return sessionId || null
}

module.exports = {
  registerImRuntimeTarget,
  clearImRuntimeSessionTarget,
  clearImRuntimeTargetSession,
}
