function normalizeKey(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function defaultSortSessions(sessions = []) {
  return [...sessions].sort((a, b) => {
    const left = b?.updatedAt || b?.createdAt || 0
    const right = a?.updatedAt || a?.createdAt || 0
    return left - right
  })
}

function listChatSessions({
  sessions,
  chatId,
  includeSession,
  sortSessions = defaultSortSessions,
}) {
  const normalizedChatId = normalizeKey(chatId)
  if (!normalizedChatId) return []

  const matched = []
  for (const session of sessions || []) {
    if (!session) continue
    if (!includeSession(session, normalizedChatId)) continue
    matched.push(session)
  }
  return sortSessions(matched)
}

function createActivatedSessionMatcher({
  imType,
  getImChannel,
  getChatId,
  isActivated,
}) {
  return (session, normalizedChatId) => {
    if (normalizeKey(getImChannel(session)) !== normalizeKey(imType)) return false
    if (!isActivated(session)) return false
    return normalizeKey(getChatId(session)) === normalizedChatId
  }
}

function isMappedCurrentSession({
  sessionMap,
  sessionId,
  mapKey = null,
}) {
  if (!sessionMap || !sessionId) return false
  if (mapKey) {
    return sessionMap.get(mapKey) === sessionId
  }
  for (const mappedSessionId of sessionMap.values()) {
    if (mappedSessionId === sessionId) return true
  }
  return false
}

function deleteSessionMappingsByPrefix({
  sessionMap,
  prefix,
  keepSessionId = null,
  deleteEntry,
}) {
  const normalizedPrefix = normalizeKey(prefix)
  if (!sessionMap || !normalizedPrefix) return
  for (const [mapKey, mappedSessionId] of sessionMap.entries()) {
    if (!String(mapKey || '').startsWith(normalizedPrefix)) continue
    if (keepSessionId && mappedSessionId === keepSessionId) continue
    if (typeof deleteEntry === 'function') {
      deleteEntry(mapKey, mappedSessionId)
      continue
    }
    sessionMap.delete(mapKey)
  }
}

function clearExactSessionMapping({
  sessionMap,
  mapKey,
  sessionId,
  deleteEntry,
}) {
  const normalizedMapKey = normalizeKey(mapKey)
  if (!sessionMap || !normalizedMapKey || !sessionId) return
  if (sessionMap.get(normalizedMapKey) !== sessionId) return
  if (typeof deleteEntry === 'function') {
    deleteEntry(normalizedMapKey, sessionId)
    return
  }
  sessionMap.delete(normalizedMapKey)
}

function clearSessionMappingsForSession({
  sessionMap,
  sessionId,
  deleteEntry,
}) {
  if (!sessionMap || !sessionId) return
  for (const [mapKey, mappedSessionId] of sessionMap.entries()) {
    if (mappedSessionId !== sessionId) continue
    if (typeof deleteEntry === 'function') {
      deleteEntry(mapKey, mappedSessionId)
      continue
    }
    sessionMap.delete(mapKey)
  }
}

module.exports = {
  listChatSessions,
  createActivatedSessionMatcher,
  isMappedCurrentSession,
  deleteSessionMappingsByPrefix,
  clearExactSessionMapping,
  clearSessionMappingsForSession,
}
