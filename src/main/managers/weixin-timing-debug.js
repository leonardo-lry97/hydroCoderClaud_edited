function isWeixinQueueTimingEnabled() {
  const value = String(process.env.HYDRO_WEIXIN_QUEUE_TIMING || '').trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'yes' || value === 'on'
}

function logWeixinQueueTiming(event, payload = {}) {
  if (!isWeixinQueueTimingEnabled()) return
  try {
    console.log(`[WeixinQueueTiming] ${event}`, JSON.stringify(payload))
  } catch {
    console.log(`[WeixinQueueTiming] ${event}`)
  }
}

module.exports = {
  isWeixinQueueTimingEnabled,
  logWeixinQueueTiming
}
