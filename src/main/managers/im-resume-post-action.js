async function runResumePostAction({
  pendingMessage,
  clearPendingMessage,
  wasActivated,
  notifyMessageReceived,
  replayPendingMessage,
  enqueueHello,
}) {
  if (pendingMessage) {
    if (typeof clearPendingMessage === 'function') {
      clearPendingMessage()
    }
    await replayPendingMessage?.(pendingMessage)
    return { mode: 'replay_pending' }
  }

  if (!wasActivated) {
    notifyMessageReceived?.()
    await enqueueHello?.()
    return { mode: 'enqueue_hello' }
  }

  return { mode: 'noop' }
}

module.exports = {
  runResumePostAction,
}
