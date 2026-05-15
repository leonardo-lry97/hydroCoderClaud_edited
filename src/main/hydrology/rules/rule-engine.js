const { buildRuleExecutionContext } = require('./rule-context-builder')
const { missingManualRule } = require('./builtin/missing-manual-rule')
const { sourceConsistencyRule } = require('./builtin/source-consistency-rule')
const { createRuleExecutionErrorHit, normalizeRuleHit } = require('./rule-types')

class HydrologyRuleEngine {
  constructor(options = {}) {
    this.rules = Array.isArray(options.rules) && options.rules.length > 0
      ? options.rules
      : [
          missingManualRule,
          sourceConsistencyRule
        ]
  }

  run(input = {}) {
    const context = buildRuleExecutionContext(input)
    return this.rules.flatMap((rule) => {
      try {
        const hits = Array.isArray(rule.run?.(context)) ? rule.run(context) : []
        return hits.map((hit) => normalizeRuleHit(hit))
      } catch (err) {
        return [createRuleExecutionErrorHit(rule, context, err)]
      }
    })
  }
}

module.exports = {
  HydrologyRuleEngine
}
