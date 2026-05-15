const { RULE_CATEGORY, RULE_SEVERITY, REVIEW_TASK_STATUS, createRuleHit } = require('../rule-types')

const waterLevelMaxBoundaryRule = {
  code: 'WL-B-002',
  name: '水位上边界检查',
  category: RULE_CATEGORY.reasonability,
  severityDefault: RULE_SEVERITY.critical,
  run(context = {}) {
    const slot = context.slot || {}
    const stationRules = context.stationRules || {}
    const maxValue = Number(stationRules.sectionMaxElevation)
    if (slot.observationType !== 'waterLevel') return []
    if (typeof slot.chosenValue !== 'number') return []
    if (Number.isNaN(maxValue)) return []
    if (slot.chosenValue <= maxValue) return []

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
        title: '水位高于断面最高高程',
        decisionMessage: '当前采用值高于站点断面最高高程，属于明确的边界越限异常。',
        suggestedAction: '请核对原始来源值、站点断面参数以及人工修正记录。',
        evidenceSummary: `采用值 ${slot.chosenValue} 高于断面最高高程 ${maxValue}。`,
        anomalyType: 'water_level_above_max_boundary',
        metrics: {
          chosenValue: slot.chosenValue,
          sectionMaxElevation: maxValue
        }
      })
    ]
  }
}

module.exports = {
  waterLevelMaxBoundaryRule
}
