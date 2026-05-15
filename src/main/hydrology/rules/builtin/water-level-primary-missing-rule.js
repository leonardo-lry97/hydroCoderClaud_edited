const { RULE_CATEGORY, RULE_SEVERITY, REVIEW_TASK_STATUS, createRuleHit } = require('../rule-types')

const waterLevelPrimaryMissingRule = {
  code: 'WL-C-001',
  name: '水位采用值缺失检查',
  category: RULE_CATEGORY.completeness,
  severityDefault: RULE_SEVERITY.critical,
  run(context = {}) {
    const slot = context.slot || {}
    if (slot.observationType !== 'waterLevel') return []
    if (typeof slot.chosenValue === 'number') return []

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
        title: '当前时槽缺少采用值',
        decisionMessage: '当前水位时槽没有形成采用值，无法进入后续审核与统计链路。',
        suggestedAction: '请补录人工值、遥测值或视频识别值，并确认采用值来源。',
        evidenceSummary: `时槽 ${slot.slotTime || '--'} 未生成 chosenValue。`,
        anomalyType: 'missing_chosen_value',
        metrics: {
          chosenValue: null
        }
      })
    ]
  }
}

module.exports = {
  waterLevelPrimaryMissingRule
}
