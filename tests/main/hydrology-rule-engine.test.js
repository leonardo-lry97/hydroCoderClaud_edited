import { describe, expect, it } from 'vitest'

describe('Hydrology rule engine', () => {
  it('creates missing-manual rule hit with normalized shape', async () => {
    const { HydrologyRuleEngine } = await import('../../src/main/hydrology/rules/rule-engine.js')
    const engine = new HydrologyRuleEngine()

    const hits = engine.run({
      slot: {
        stationId: 'station-1',
        observationType: 'waterLevel',
        slotTime: '2026-05-15 08:00',
        telemetryValue: 5.18
      },
      expectedSources: {
        manual: true,
        telemetry: true,
        videoOcr: false
      }
    })

    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({
      ruleCode: 'W-001',
      ruleName: '人工观测值缺失',
      ruleCategory: 'completeness',
      severity: 'warning',
      status: 'needs_review',
      stationId: 'station-1',
      observationType: 'waterLevel',
      slotTime: '2026-05-15 08:00',
      anomalyType: 'missing_manual'
    })
    expect(hits[0].metrics).toEqual({ manualValue: null })
    expect(hits[0].sourceReadingIds).toEqual([])
    expect(hits[0].compareReadingIds).toEqual([])
  })

  it('creates consistency rule hit for conflicting source values', async () => {
    const { HydrologyRuleEngine } = await import('../../src/main/hydrology/rules/rule-engine.js')
    const engine = new HydrologyRuleEngine()

    const hits = engine.run({
      slot: {
        stationId: 'station-2',
        observationType: 'waterLevel',
        slotTime: '2026-05-15 09:00',
        manualValue: 5,
        telemetryValue: 5.4,
        videoOcrValue: 5.35,
        chosenValue: 5,
        compareStatus: 'conflict'
      },
      expectedSources: {
        manual: true,
        telemetry: true,
        videoOcr: true
      }
    })

    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({
      ruleCode: 'W-002',
      ruleCategory: 'consistency',
      severity: 'critical',
      title: '多源数值冲突',
      anomalyType: 'source_inconsistency'
    })
    expect(hits[0].metrics).toMatchObject({
      compareStatus: 'conflict',
      manualValue: 5,
      telemetryValue: 5.4,
      videoOcrValue: 5.35,
      chosenValue: 5
    })
  })

  it('returns normalized fallback hit when rule execution throws', async () => {
    const { HydrologyRuleEngine } = await import('../../src/main/hydrology/rules/rule-engine.js')
    const engine = new HydrologyRuleEngine({
      rules: [{
        code: 'X-001',
        name: '爆炸规则',
        category: 'system',
        run() {
          throw new Error('boom')
        }
      }]
    })

    const hits = engine.run({
      slot: {
        stationId: 'station-3',
        observationType: 'airTemperature',
        slotTime: '2026-05-15 10:00'
      }
    })

    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({
      ruleCode: 'X-001',
      ruleName: '爆炸规则',
      ruleCategory: 'system',
      severity: 'warning',
      status: 'needs_review',
      stationId: 'station-3',
      observationType: 'airTemperature',
      slotTime: '2026-05-15 10:00',
      title: '爆炸规则执行失败',
      anomalyType: 'rule_execution_error'
    })
    expect(hits[0].decisionMessage).toContain('boom')
    expect(hits[0].sourceReadingIds).toEqual([])
    expect(hits[0].compareReadingIds).toEqual([])
  })
})
