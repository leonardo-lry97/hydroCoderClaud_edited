const { RULE_CATEGORY, RULE_SEVERITY, REVIEW_TASK_STATUS, createRuleHit } = require('../rule-types')

const waterLevelMinBoundaryRule = {
  code: 'WL-B-001',
  name: '水位下边界检查',
  category: RULE_CATEGORY.reasonability,
  severityDefault: RULE_SEVERITY.critical,
  run(context = {}) {
    const slot = context.slot || {}
    const stationRules = context.stationRules || {}
    const minValue = Number(stationRules.sectionMinElevation)
    if (slot.observationType !== 'waterLevel') return []
    if (typeof slot.chosenValue !== 'number') return []
    if (Number.isNaN(minValue)) return []
    if (slot.chosenValue >= minValue) return []

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
        title: '水位低于断面最低高程',
        decisionMessage: '当前采用值低于站点断面最低高程，属于明确的边界越限异常。',
        suggestedAction: '请核对原始来源值、站点断面参数以及人工修正记录。',
        evidenceSummary: `采用值 ${slot.chosenValue} 低于断面最低高程 ${minValue}。`,
        anomalyType: 'water_level_below_min_boundary',
        metrics: {
          chosenValue: slot.chosenValue,
          sectionMinElevation: minValue
        }
      })
    ]
  }
}

module.exports = {
  waterLevelMinBoundaryRule
}
