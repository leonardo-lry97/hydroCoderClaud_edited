const { RULE_CATEGORY, RULE_SEVERITY, REVIEW_TASK_STATUS, createRuleHit } = require('../rule-types')

const waterLevelHourlyDeltaRule = {
  code: 'WL-T-001',
  name: '水位小时变幅检查',
  category: RULE_CATEGORY.sequenceQuality,
  severityDefault: RULE_SEVERITY.warning,
  run(context = {}) {
    const slot = context.slot || {}
    const previousSlot = context.previousSlot || {}
    const stationRules = context.stationRules || {}
    const threshold = Number(stationRules.maxHourlyDelta)
    if (slot.observationType !== 'waterLevel') return []
    if (typeof slot.chosenValue !== 'number' || typeof previousSlot.chosenValue !== 'number') return []
    if (Number.isNaN(threshold)) return []

    const hourlyDelta = Math.abs(slot.chosenValue - previousSlot.chosenValue)
    if (hourlyDelta <= threshold) return []

    return [
      createRuleHit({
        ruleCode: this.code,
        ruleName: this.name,
        ruleCategory: this.category,
        severity: this.severityDefault,
        status: REVIEW_TASK_STATUS.needsReview,
        stationId: slot.stationId,
        observationType: slot.observationType,
        slotTime: slot.slotTime,
        title: '水位小时变幅超阈值',
        decisionMessage: '当前时槽采用值与上一时槽相比变幅过大，存在突变或来源异常的风险。',
        suggestedAction: '请结合上一个时槽、遥测过程线与视频参考值复核该小时水位变化。',
        evidenceSummary: `当前采用值 ${slot.chosenValue}，上一时槽 ${previousSlot.chosenValue}，绝对变幅 ${hourlyDelta}，阈值 ${threshold}。`,
        anomalyType: 'water_level_hourly_delta_exceeded',
        metrics: {
          chosenValue: slot.chosenValue,
          previousChosenValue: previousSlot.chosenValue,
          hourlyDelta,
          maxHourlyDelta: threshold
        }
      })
    ]
  }
}

module.exports = {
  waterLevelHourlyDeltaRule
}
