function buildRuleExecutionContext(input = {}) {
  return {
    station: input.station || null,
    slot: input.slot || null,
    previousSlot: input.previousSlot || null,
    observations: Array.isArray(input.observations) ? input.observations : [],
    expectedSources: input.expectedSources && typeof input.expectedSources === 'object'
      ? input.expectedSources
      : {},
    stationRules: input.stationRules && typeof input.stationRules === 'object'
      ? input.stationRules
      : {},
    businessDate: String(input.businessDate || '').trim() || null,
    metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {}
  }
}

module.exports = {
  buildRuleExecutionContext
}
