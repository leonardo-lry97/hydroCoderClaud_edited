const { buildRuleExecutionContext } = require('./rule-context-builder')
const { waterLevelPrimaryMissingRule } = require('./builtin/water-level-primary-missing-rule')
const { waterLevelManualMissingRule } = require('./builtin/water-level-manual-missing-rule')
const { waterLevelVideoMissingRule } = require('./builtin/water-level-video-missing-rule')
const { waterLevelMinBoundaryRule } = require('./builtin/water-level-min-boundary-rule')
const { waterLevelMaxBoundaryRule } = require('./builtin/water-level-max-boundary-rule')
const { waterLevelHourlyDeltaRule } = require('./builtin/water-level-hourly-delta-rule')
const { waterLevelManualVideoDiffRule } = require('./builtin/water-level-manual-video-diff-rule')
const { createRuleExecutionErrorHit, normalizeRuleHit } = require('./rule-types')

function hasNumericValue(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function buildPassEvaluation(rule, context = {}) {
  const slot = context.slot || {}
  const stationRules = context.stationRules || {}
  const expectedSources = context.expectedSources || {}
  const previousSlot = context.previousSlot || {}

  switch (rule.code) {
    case 'WL-C-001':
      if (slot.observationType !== 'waterLevel') {
        return {
          status: 'skipped',
          decisionMessage: '当前观测类型不适用水位采用值检查。',
          evidenceSummary: '仅对水位时槽执行。',
          suggestedAction: ''
        }
      }
      return {
        status: 'passed',
        decisionMessage: '当前时槽已形成采用值。',
        evidenceSummary: `采用值 ${slot.chosenValue} 可进入后续审核与统计链路。`,
        suggestedAction: '',
        metrics: {
          chosenValue: slot.chosenValue
        }
      }
    case 'WL-C-002':
      if (slot.observationType !== 'waterLevel') {
        return {
          status: 'skipped',
          decisionMessage: '当前观测类型不适用人工水位检查。',
          evidenceSummary: '仅对水位时槽执行。',
          suggestedAction: ''
        }
      }
      if (stationRules.requireManualObservation === false) {
        return {
          status: 'skipped',
          decisionMessage: '当前站点未启用人工值必报要求。',
          evidenceSummary: '规则配置 requireManualObservation=false。',
          suggestedAction: ''
        }
      }
      return {
        status: 'passed',
        decisionMessage: '当前时槽已存在人工观测值。',
        evidenceSummary: `人工值 ${slot.manualValue} 已参与本时槽检查。`,
        suggestedAction: '',
        metrics: {
          manualValue: slot.manualValue
        }
      }
    case 'WL-C-003':
      if (slot.observationType !== 'waterLevel') {
        return {
          status: 'skipped',
          decisionMessage: '当前观测类型不适用视频参考检查。',
          evidenceSummary: '仅对水位时槽执行。',
          suggestedAction: ''
        }
      }
      if (!expectedSources.videoOcr) {
        return {
          status: 'skipped',
          decisionMessage: '当前站点未启用视频识别来源。',
          evidenceSummary: 'expectedSources.videoOcr=false。',
          suggestedAction: ''
        }
      }
      if (stationRules.requireVideoReference === false) {
        return {
          status: 'skipped',
          decisionMessage: '当前站点未启用视频参考必检要求。',
          evidenceSummary: '规则配置 requireVideoReference=false。',
          suggestedAction: ''
        }
      }
      return {
        status: 'passed',
        decisionMessage: '当前时槽已存在视频识别参考值。',
        evidenceSummary: `视频值 ${slot.videoOcrValue} 已参与人工值核对。`,
        suggestedAction: '',
        metrics: {
          videoOcrValue: slot.videoOcrValue
        }
      }
    case 'WL-B-001': {
      const minValue = Number(stationRules.sectionMinElevation)
      if (slot.observationType !== 'waterLevel') {
        return {
          status: 'skipped',
          decisionMessage: '当前观测类型不适用水位下边界检查。',
          evidenceSummary: '仅对水位时槽执行。',
          suggestedAction: ''
        }
      }
      if (!hasNumericValue(slot.chosenValue)) {
        return {
          status: 'skipped',
          decisionMessage: '当前时槽缺少采用值，无法执行下边界比较。',
          evidenceSummary: 'chosenValue 不存在。',
          suggestedAction: ''
        }
      }
      if (Number.isNaN(minValue)) {
        return {
          status: 'skipped',
          decisionMessage: '当前站点未配置断面最低高程。',
          evidenceSummary: 'sectionMinElevation 不是有效数值。',
          suggestedAction: ''
        }
      }
      return {
        status: 'passed',
        decisionMessage: '当前采用值未低于断面最低高程。',
        evidenceSummary: `采用值 ${slot.chosenValue}，断面最低高程 ${minValue}。`,
        suggestedAction: '',
        metrics: {
          chosenValue: slot.chosenValue,
          sectionMinElevation: minValue
        }
      }
    }
    case 'WL-B-002': {
      const maxValue = Number(stationRules.sectionMaxElevation)
      if (slot.observationType !== 'waterLevel') {
        return {
          status: 'skipped',
          decisionMessage: '当前观测类型不适用水位上边界检查。',
          evidenceSummary: '仅对水位时槽执行。',
          suggestedAction: ''
        }
      }
      if (!hasNumericValue(slot.chosenValue)) {
        return {
          status: 'skipped',
          decisionMessage: '当前时槽缺少采用值，无法执行上边界比较。',
          evidenceSummary: 'chosenValue 不存在。',
          suggestedAction: ''
        }
      }
      if (Number.isNaN(maxValue)) {
        return {
          status: 'skipped',
          decisionMessage: '当前站点未配置断面最高高程。',
          evidenceSummary: 'sectionMaxElevation 不是有效数值。',
          suggestedAction: ''
        }
      }
      return {
        status: 'passed',
        decisionMessage: '当前采用值未高于断面最高高程。',
        evidenceSummary: `采用值 ${slot.chosenValue}，断面最高高程 ${maxValue}。`,
        suggestedAction: '',
        metrics: {
          chosenValue: slot.chosenValue,
          sectionMaxElevation: maxValue
        }
      }
    }
    case 'WL-T-001': {
      const threshold = Number(stationRules.maxHourlyDelta)
      if (slot.observationType !== 'waterLevel') {
        return {
          status: 'skipped',
          decisionMessage: '当前观测类型不适用水位小时变幅检查。',
          evidenceSummary: '仅对水位时槽执行。',
          suggestedAction: ''
        }
      }
      if (!hasNumericValue(slot.chosenValue) || !hasNumericValue(previousSlot.chosenValue)) {
        return {
          status: 'skipped',
          decisionMessage: '缺少本时槽或上一时槽采用值，无法执行小时变幅比较。',
          evidenceSummary: '需要当前时槽与上一时槽的采用值。',
          suggestedAction: ''
        }
      }
      if (Number.isNaN(threshold)) {
        return {
          status: 'skipped',
          decisionMessage: '当前站点未配置小时变幅阈值。',
          evidenceSummary: 'maxHourlyDelta 不是有效数值。',
          suggestedAction: ''
        }
      }
      const hourlyDelta = Math.abs(slot.chosenValue - previousSlot.chosenValue)
      return {
        status: 'passed',
        decisionMessage: '当前时槽相对上一时槽的变幅在允许阈值内。',
        evidenceSummary: `当前采用值 ${slot.chosenValue}，上一时槽 ${previousSlot.chosenValue}，绝对变幅 ${hourlyDelta}，阈值 ${threshold}。`,
        suggestedAction: '',
        metrics: {
          chosenValue: slot.chosenValue,
          previousChosenValue: previousSlot.chosenValue,
          hourlyDelta,
          maxHourlyDelta: threshold
        }
      }
    }
    case 'WL-V-001': {
      const tolerance = Number(stationRules.manualVideoTolerance)
      if (slot.observationType !== 'waterLevel') {
        return {
          status: 'skipped',
          decisionMessage: '当前观测类型不适用人工与视频差值检查。',
          evidenceSummary: '仅对水位时槽执行。',
          suggestedAction: ''
        }
      }
      if (!hasNumericValue(slot.manualValue) || !hasNumericValue(slot.videoOcrValue)) {
        return {
          status: 'skipped',
          decisionMessage: '缺少人工值或视频值，无法执行人工与视频差值比较。',
          evidenceSummary: '需要同时具备 manualValue 与 videoOcrValue。',
          suggestedAction: ''
        }
      }
      if (Number.isNaN(tolerance)) {
        return {
          status: 'skipped',
          decisionMessage: '当前站点未配置人工与视频容差阈值。',
          evidenceSummary: 'manualVideoTolerance 不是有效数值。',
          suggestedAction: ''
        }
      }
      const diff = Math.abs(slot.manualValue - slot.videoOcrValue)
      return {
        status: 'passed',
        decisionMessage: '人工值与视频识别值差值在允许容差内。',
        evidenceSummary: `人工值 ${slot.manualValue}，视频值 ${slot.videoOcrValue}，差值 ${diff}，容差 ${tolerance}。`,
        suggestedAction: '',
        metrics: {
          manualValue: slot.manualValue,
          videoOcrValue: slot.videoOcrValue,
          manualVideoDiff: diff,
          manualVideoTolerance: tolerance
        }
      }
    }
    default:
      return {
        status: 'passed',
        decisionMessage: '本规则本次未命中。',
        evidenceSummary: '规则已执行，未发现异常。',
        suggestedAction: '',
        metrics: {}
      }
  }
}

function buildRuleEvaluation(rule, context = {}, hits = [], error = null) {
  if (error) {
    const fallbackHit = createRuleExecutionErrorHit(rule, context, error)
    return {
      ruleCode: fallbackHit.ruleCode,
      ruleName: fallbackHit.ruleName,
      ruleCategory: fallbackHit.ruleCategory,
      severity: fallbackHit.severity,
      status: 'error',
      decisionMessage: fallbackHit.decisionMessage,
      evidenceSummary: fallbackHit.evidenceSummary,
      suggestedAction: fallbackHit.suggestedAction,
      metrics: fallbackHit.metrics,
      hits: [fallbackHit]
    }
  }

  if (hits.length > 0) {
    const firstHit = hits[0]
    return {
      ruleCode: firstHit.ruleCode,
      ruleName: firstHit.ruleName,
      ruleCategory: firstHit.ruleCategory,
      severity: firstHit.severity,
      status: 'hit',
      decisionMessage: firstHit.decisionMessage,
      evidenceSummary: firstHit.evidenceSummary,
      suggestedAction: firstHit.suggestedAction,
      metrics: firstHit.metrics,
      hits
    }
  }

  const passEvaluation = buildPassEvaluation(rule, context)
  const evaluationStatus = passEvaluation.status || 'passed'
  return {
    ruleCode: rule.code || 'unknown_rule',
    ruleName: rule.name || '未知规则',
    ruleCategory: rule.category || 'system',
    severity: evaluationStatus === 'hit' || evaluationStatus === 'error' ? (rule.severityDefault || null) : null,
    status: evaluationStatus,
    decisionMessage: passEvaluation.decisionMessage || '本规则本次检查通过。',
    evidenceSummary: passEvaluation.evidenceSummary || '规则已执行，未发现异常。',
    suggestedAction: passEvaluation.suggestedAction || '',
    metrics: passEvaluation.metrics || {},
    hits: []
  }
}

class HydrologyRuleEngine {
  constructor(options = {}) {
    this.rules = Array.isArray(options.rules) && options.rules.length > 0
      ? options.rules
      : [
          waterLevelPrimaryMissingRule,
          waterLevelManualMissingRule,
          waterLevelVideoMissingRule,
          waterLevelMinBoundaryRule,
          waterLevelMaxBoundaryRule,
          waterLevelHourlyDeltaRule,
          waterLevelManualVideoDiffRule
        ]
  }

  evaluate(input = {}) {
    const context = buildRuleExecutionContext(input)
    const evaluations = []
    const hits = []

    this.rules.forEach((rule) => {
      try {
        const nextHits = Array.isArray(rule.run?.(context)) ? rule.run(context).map((hit) => normalizeRuleHit(hit)) : []
        evaluations.push(buildRuleEvaluation(rule, context, nextHits))
        hits.push(...nextHits)
      } catch (err) {
        const fallbackHit = createRuleExecutionErrorHit(rule, context, err)
        evaluations.push(buildRuleEvaluation(rule, context, [], err))
        hits.push(fallbackHit)
      }
    })

    return {
      context,
      evaluations,
      hits
    }
  }

  run(input = {}) {
    return this.evaluate(input).hits
  }
}

module.exports = {
  HydrologyRuleEngine
}
