const { RULE_CATEGORY, RULE_SEVERITY, REVIEW_TASK_STATUS, createRuleHit } = require('../rule-types')

const waterLevelVideoMissingRule = {
  code: 'WL-C-003',
  name: '视频参考缺失提示',
  category: RULE_CATEGORY.completeness,
  severityDefault: RULE_SEVERITY.info,
  run(context = {}) {
    const slot = context.slot || {}
    const stationRules = context.stationRules || {}
    const expectedSources = context.expectedSources || {}
    if (slot.observationType !== 'waterLevel') return []
    if (!expectedSources.videoOcr) return []
    if (stationRules.requireVideoReference === false) return []
    if (typeof slot.videoOcrValue === 'number') return []

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
        title: '视频参考缺失',
        decisionMessage: '当前时槽缺少视频识别参考值，会降低人工值与遥测值核对的把握度。',
        suggestedAction: '请检查视频识别链路是否正常，必要时人工查看截图或现场图像。',
        evidenceSummary: `时槽 ${slot.slotTime || '--'} 未找到视频识别值。`,
        anomalyType: 'missing_video_reference',
        metrics: {
          videoOcrValue: null
        }
      })
    ]
  }
}

module.exports = {
  waterLevelVideoMissingRule
}
