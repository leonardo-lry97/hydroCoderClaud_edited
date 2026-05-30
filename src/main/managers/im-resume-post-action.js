const { activateNewSession } = require('./im-session-command-flow')

async function runResumePostAction({
  pendingMessage,
  clearPendingMessage,
  wasActivated,
  notifyMessageReceived,
  replayPendingMessage,
  enqueueHello,
}) {
  const result = await activateNewSession({
    sessionId: 'resume-post-action',
    pendingMessage,
    clearPendingMessage,
    wasActivated,
    notifyMessageReceived,
    replayPendingMessage,
    enqueueHello,
  })
  return { mode: result?.mode || 'noop' }
}

module.exports = {
  runResumePostAction,
}
