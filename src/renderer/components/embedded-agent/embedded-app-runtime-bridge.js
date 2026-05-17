export function createEmbeddedAppRuntimeBridge(hydroAgent, { appId, getContext, commandHandler } = {}) {
  if (!hydroAgent || typeof hydroAgent.connect !== 'function' || !appId) {
    return null
  }

  const readContext = () => {
    if (typeof getContext !== 'function') return null
    const next = getContext()
    return next && typeof next === 'object' ? next : null
  }

  const syncContext = async () => {
    if (typeof hydroAgent.updateContext !== 'function') return null
    const context = readContext()
    await hydroAgent.updateContext(context)
    return context
  }

  const registerCommandHandler = () => {
    if (typeof hydroAgent.onCommandRequest !== 'function' || typeof commandHandler !== 'function') {
      return () => {}
    }

    return hydroAgent.onCommandRequest(async (request) => {
      if (request?.appId !== appId) {
        return false
      }
      return await commandHandler({
        command: request.command,
        payload: request.payload || {},
        appId: request.appId,
        clientId: request.clientId
      })
    })
  }

  return {
    syncContext,
    registerCommandHandler
  }
}
