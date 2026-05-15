const { RULE_CATEGORY, RULE_SEVERITY, REVIEW_TASK_STATUS, createRuleHit } = require('../rule-types')

const waterLevelManualMissingRule = {
  code: 'WL-C-002',
  name: '人工水位缺失检查',
  category: RULE_CATEGORY.completeness,
  severityDefault: RULE_SEVERITY.warning,
  run(context = {}) {
    const slot = context.slot || {}
    const stationRules = context.stationRules || {}
    if (slot.observationType !== 'waterLevel') return []
    if (stationRules.requireManualObservation === false) return []
    if (typeof slot.manualValue === 'number') return []

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
        title: '人工观测值缺失',
        decisionMessage: '当前水位时槽缺少人工观测值，需要人工确认是否漏报或确无人工记录。',
        suggestedAction: '请补录人工观测值，或明确标记该时槽无人工记录。',
        evidenceSummary: `时槽 ${slot.slotTime || '--'} 未找到人工水位值。`,
        anomalyType: 'missing_manual',
        metrics: {
          manualValue: null
        }
      })
    ]
  }
}

module.exports = {
  waterLevelManualMissingRule
}
