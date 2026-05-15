const RULE_CATEGORY = {
  completeness: 'completeness',
  consistency: 'consistency',
  reasonability: 'reasonability',
  sequenceQuality: 'sequence_quality'
}

const RULE_SEVERITY = {
  info: 'info',
  warning: 'warning',
  critical: 'critical'
}

const REVIEW_TASK_STATUS = {
  pending: 'pending',
  running: 'running',
  completed: 'completed',
  needsReview: 'needs_review',
  resolved: 'resolved'
}

function createRuleHit(input = {}) {
  return {
    ruleCode: String(input.ruleCode || '').trim(),
    ruleName: String(input.ruleName || '').trim(),
    ruleCategory: String(input.ruleCategory || RULE_CATEGORY.completeness).trim(),
    severity: String(input.severity || RULE_SEVERITY.warning).trim(),
    status: String(input.status || REVIEW_TASK_STATUS.needsReview).trim(),
    stationId: String(input.stationId || '').trim(),
    observationType: String(input.observationType || '').trim(),
    slotTime: String(input.slotTime || '').trim(),
    title: String(input.title || '').trim(),
    decisionMessage: String(input.decisionMessage || '').trim(),
    suggestedAction: String(input.suggestedAction || '').trim(),
    evidenceSummary: String(input.evidenceSummary || '').trim(),
    anomalyType: String(input.anomalyType || '').trim() || null,
    metrics: input.metrics && typeof input.metrics === 'object' ? input.metrics : {},
    sourceReadingIds: Array.isArray(input.sourceReadingIds) ? input.sourceReadingIds : [],
    compareReadingIds: Array.isArray(input.compareReadingIds) ? input.compareReadingIds : []
  }
}

function normalizeRuleHit(input = {}) {
  return createRuleHit(input)
}

function createRuleExecutionErrorHit(rule = {}, context = {}, error = null) {
  return createRuleHit({
    ruleCode: rule.code || 'unknown_rule',
    ruleName: rule.name || '未知规则',
    ruleCategory: rule.category || 'system',
    severity: RULE_SEVERITY.warning,
    status: REVIEW_TASK_STATUS.needsReview,
    stationId: context.slot?.stationId || '',
    observationType: context.slot?.observationType || '',
    slotTime: context.slot?.slotTime || '',
    title: `${rule.name || '规则'}执行失败`,
    decisionMessage: error?.message || String(error || '规则执行异常'),
    suggestedAction: '请检查规则实现或输入上下文。',
    evidenceSummary: '规则执行异常',
    anomalyType: 'rule_execution_error',
    metrics: {}
  })
}

module.exports = {
  RULE_CATEGORY,
  RULE_SEVERITY,
  REVIEW_TASK_STATUS,
  createRuleHit,
  normalizeRuleHit,
  createRuleExecutionErrorHit
}
