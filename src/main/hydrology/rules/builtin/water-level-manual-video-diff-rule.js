const { RULE_CATEGORY, RULE_SEVERITY, REVIEW_TASK_STATUS, createRuleHit } = require('../rule-types')

const waterLevelManualVideoDiffRule = {
  code: 'WL-V-001',
  name: '人工水位与视频识别差值检查',
  category: RULE_CATEGORY.consistency,
  severityDefault: RULE_SEVERITY.warning,
  run(context = {}) {
    const slot = context.slot || {}
    const stationRules = context.stationRules || {}
    const tolerance = Number(stationRules.manualVideoTolerance)
    if (slot.observationType !== 'waterLevel') return []
    if (typeof slot.manualValue !== 'number' || typeof slot.videoOcrValue !== 'number') return []
    if (Number.isNaN(tolerance)) return []

    const diff = Math.abs(slot.manualValue - slot.videoOcrValue)
    if (diff <= tolerance) return []

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
        title: '人工水位与视频识别偏差超容差',
        decisionMessage: '人工观测值与视频识别值偏差超出允许容差，需要确认人工记录、视频识别或采用值是否正确。',
        suggestedAction: '请查看视频截图、人工记录和遥测参考值，必要时执行人工修正。',
        evidenceSummary: `人工值 ${slot.manualValue} 与视频值 ${slot.videoOcrValue} 的差值为 ${diff}，容差 ${tolerance}。`,
        anomalyType: 'water_level_manual_video_diff',
        metrics: {
          manualValue: slot.manualValue,
          videoOcrValue: slot.videoOcrValue,
          manualVideoDiff: diff,
          manualVideoTolerance: tolerance
        }
      })
    ]
  }
}

module.exports = {
  waterLevelManualVideoDiffRule
}
