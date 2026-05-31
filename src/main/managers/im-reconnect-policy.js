const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 16000, 32000, 32000, 32000]
const MAX_RECONNECT_ATTEMPTS = RECONNECT_DELAYS_MS.length

function getReconnectDelayMs(attemptNumber) {
  const normalizedAttempt = Math.max(1, Number(attemptNumber) || 1)
  const index = Math.min(normalizedAttempt, MAX_RECONNECT_ATTEMPTS) - 1
  return RECONNECT_DELAYS_MS[index]
}

module.exports = {
  RECONNECT_DELAYS_MS,
  MAX_RECONNECT_ATTEMPTS,
  getReconnectDelayMs,
}
