const { HydrologyRuleEngine } = require('./rules/rule-engine')
const {
  parseReviewTaskRow,
  buildAutoResolutionNote,
  isPersistableObservationAnomalyHit,
  toObservationAnomalyPayload
} = require('./review-task-helpers')

class ReviewTaskService {
  constructor(hydrologyDatabase, options = {}) {
    this.db = hydrologyDatabase
    this.ruleEngine = options.ruleEngine || new HydrologyRuleEngine()
  }

  syncSlotReviewTasks(input = {}) {
    const {
      station,
      slot,
      previousSlot = null,
      observations = [],
      expectedSources = {},
      stationRules = {}
    } = input
    if (!station?.id || !slot?.slotTime || !slot?.observationType) {
      return []
    }

    const executionResult = this.ruleEngine.evaluate({
      station,
      slot,
      previousSlot,
      observations,
      expectedSources,
      stationRules,
      metadata: {
        stationCode: station.code,
        stationName: station.name
      }
    })
    const hits = Array.isArray(executionResult?.hits) ? executionResult.hits : []
    const activeRuleCodes = hits
      .map((hit) => String(hit.ruleCode || '').trim())
      .filter(Boolean)

    hits.forEach((hit) => {
      this.db.upsertReviewTask(hit)
      if (isPersistableObservationAnomalyHit(hit)) {
        this.db.upsertObservationAnomaly(toObservationAnomalyPayload(hit, {
          status: hit.status === 'resolved' ? 'closed' : 'open'
        }))
      }
    })

    const staleResolution = this.db.resolveStaleReviewTasks({
      stationId: slot.stationId,
      observationType: slot.observationType,
      slotTime: slot.slotTime,
      activeRuleCodes,
      status: 'resolved',
      resolvedBy: 'system',
      resolutionNote: buildAutoResolutionNote(slot)
    })

    for (const task of staleResolution.tasks || []) {
      if (!isPersistableObservationAnomalyHit(task)) continue
      const anomalyPayload = toObservationAnomalyPayload(task, {
        status: 'closed',
        resolutionNote: task.resolution_note || buildAutoResolutionNote(slot)
      })
      this.db.updateAnomalyStatus(anomalyPayload)
    }

    return {
      hits,
      ruleEvaluations: Array.isArray(executionResult?.evaluations) ? executionResult.evaluations : []
    }
  }

  listReviewTasks(filters = {}) {
    const stationId = String(filters.stationId || '').trim()
    if (!stationId) throw new Error('站点 ID 不能为空')
    const observationType = String(filters.observationType || '').trim() || null
    const status = String(filters.status || '').trim() || null
    return this.db
      .listReviewTasks(stationId, observationType, status)
      .map(parseReviewTaskRow)
  }

  resolveReviewTask(taskId, payload = {}) {
    if (!taskId) throw new Error('审核任务 ID 不能为空')
    const next = this.db.resolveReviewTask(taskId, payload)
    const parsed = parseReviewTaskRow(next)
    if (isPersistableObservationAnomalyHit(parsed)) {
      this.db.updateAnomalyStatus(toObservationAnomalyPayload(parsed, {
        status: parsed.status === 'resolved' ? 'closed' : 'open',
        resolutionNote: parsed.resolutionNote
      }))
    }
    return parsed
  }
}

module.exports = {
  ReviewTaskService
}
