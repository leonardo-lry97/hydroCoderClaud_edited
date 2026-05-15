class QualityCheckService {
  constructor(options = {}) {
    this.stationService = options.stationService || null
    this.realtimeService = options.realtimeService || null
  }

  runStationQualityCheck(input = {}) {
    const stationId = String(input.stationId || '').trim()
    const observationType = String(input.observationType || '').trim() || 'waterLevel'
    if (!stationId) throw new Error('站点 ID 不能为空')
    if (!this.stationService || !this.realtimeService) {
      throw new Error('QualityCheckService dependencies not available')
    }

    const station = this.stationService.getStation(stationId)
    if (!station) {
      throw new Error('站点不存在')
    }

    const slots = this.realtimeService.listRealtimeSlots({
      stationId,
      observationType,
      fromTime: input.fromTime || null,
      toTime: input.toTime || null
    })

    const slotResults = slots.map((slot) => {
      const executionResult = this.realtimeService.syncReviewTasksForSlot(stationId, observationType, slot.slotTime, slot)
      const hits = Array.isArray(executionResult)
        ? executionResult
        : Array.isArray(executionResult?.hits)
          ? executionResult.hits
          : []
      const ruleEvaluations = Array.isArray(executionResult?.ruleEvaluations)
        ? executionResult.ruleEvaluations
        : []
      return {
        slotId: slot.id,
        slotTime: slot.slotTime,
        slot,
        hitCount: hits.length,
        hitRuleCodes: hits.map((item) => item.ruleCode).filter(Boolean),
        hitsBySeverity: hits.reduce((acc, item) => {
          const key = item.severity || 'warning'
          acc[key] = (acc[key] || 0) + 1
          return acc
        }, {}),
        hits,
        ruleEvaluations
      }
    })

    const allHits = slotResults.flatMap((item) => item.hits)
    const hitsBySeverity = allHits.reduce((acc, item) => {
      const key = item.severity || 'warning'
      acc[key] = (acc[key] || 0) + 1
      return acc
    }, {})
    const hitsByRuleCode = allHits.reduce((acc, item) => {
      const key = String(item.ruleCode || '').trim()
      if (!key) return acc
      acc[key] = (acc[key] || 0) + 1
      return acc
    }, {})
    const hitRuleCodes = Object.keys(hitsByRuleCode)

    return {
      stationId,
      stationCode: station.code,
      stationName: station.name,
      observationType,
      checkedSlotCount: slotResults.length,
      hitCount: allHits.length,
      hitRuleCodes,
      hitsByRuleCode,
      hitsBySeverity,
      slotResults
    }
  }
}

module.exports = {
  QualityCheckService
}
