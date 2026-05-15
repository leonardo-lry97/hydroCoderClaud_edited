import { describe, expect, it } from 'vitest'

describe('Hydrology rule engine', () => {
  it('creates water-level missing and video prompt hits with normalized shape', async () => {
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
        videoOcr: true
      },
      stationRules: {
        requireManualObservation: true,
        requireVideoReference: true
      }
    })

    expect(hits).toHaveLength(3)
    expect(hits[0]).toMatchObject({
      ruleCode: 'WL-C-001',
      ruleName: '水位采用值缺失检查',
      ruleCategory: 'completeness',
      severity: 'critical',
      status: 'needs_review',
      stationId: 'station-1',
      observationType: 'waterLevel',
      slotTime: '2026-05-15 08:00',
      anomalyType: 'missing_chosen_value'
    })
    expect(hits[1]).toMatchObject({
      ruleCode: 'WL-C-002',
      anomalyType: 'missing_manual'
    })
    expect(hits[2]).toMatchObject({
      ruleCode: 'WL-C-003',
      severity: 'info',
      anomalyType: 'missing_video_reference'
    })
  })

  it('creates manual-video consistency rule hit for large diff', async () => {
    const { HydrologyRuleEngine } = await import('../../src/main/hydrology/rules/rule-engine.js')
    const engine = new HydrologyRuleEngine()

    const hits = engine.run({
      slot: {
        stationId: 'station-2',
        observationType: 'waterLevel',
        slotTime: '2026-05-15 09:00',
        manualValue: 5,
        telemetryValue: 5.05,
        videoOcrValue: 5.35,
        chosenValue: 5,
        compareStatus: 'significant_diff'
      },
      stationRules: {
        manualVideoTolerance: 0.1
      }
    })

    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({
      ruleCode: 'WL-V-001',
      ruleCategory: 'consistency',
      severity: 'warning',
      title: '人工水位与视频识别偏差超容差',
      anomalyType: 'water_level_manual_video_diff'
    })
    expect(hits[0].metrics).toMatchObject({
      manualValue: 5,
      videoOcrValue: 5.35,
      manualVideoTolerance: 0.1
    })
  })

  it('returns full rule evaluations including passed and skipped results', async () => {
    const { HydrologyRuleEngine } = await import('../../src/main/hydrology/rules/rule-engine.js')
    const engine = new HydrologyRuleEngine()

    const result = engine.evaluate({
      slot: {
        stationId: 'station-5',
        observationType: 'waterLevel',
        slotTime: '2026-05-15 12:00',
        manualValue: 5.2,
        telemetryValue: 5.18,
        videoOcrValue: 5.19,
        chosenValue: 5.2
      },
      previousSlot: {
        stationId: 'station-5',
        observationType: 'waterLevel',
        slotTime: '2026-05-15 11:00',
        chosenValue: 5.16
      },
      expectedSources: {
        manual: true,
        telemetry: true,
        videoOcr: true
      },
      stationRules: {
        requireManualObservation: true,
        requireVideoReference: true,
        sectionMinElevation: 0,
        sectionMaxElevation: 10,
        maxHourlyDelta: 0.1,
        manualVideoTolerance: 0.1
      }
    })

    expect(result.hits).toHaveLength(0)
    expect(result.evaluations).toHaveLength(7)
    expect(result.evaluations.find((item) => item.ruleCode === 'WL-C-001')).toMatchObject({
      status: 'passed'
    })
    expect(result.evaluations.find((item) => item.ruleCode === 'WL-T-001')).toMatchObject({
      status: 'passed'
    })
    expect(result.evaluations.find((item) => item.ruleCode === 'WL-V-001')?.metrics).toMatchObject({
      manualValue: 5.2,
      videoOcrValue: 5.19,
      manualVideoTolerance: 0.1
    })
  })

  it('keeps manual-missing semantics separate from corrected chosen value', async () => {
    const { HydrologyRuleEngine } = await import('../../src/main/hydrology/rules/rule-engine.js')
    const engine = new HydrologyRuleEngine()

    const hits = engine.run({
      slot: {
        stationId: 'station-corrected',
        observationType: 'waterLevel',
        slotTime: '2026-05-15 11:00',
        manualValue: null,
        correctedValue: 4.92,
        telemetryValue: 4.9,
        videoOcrValue: 4.91,
        chosenValue: 4.92
      },
      expectedSources: {
        manual: true,
        telemetry: true,
        videoOcr: true
      },
      stationRules: {
        requireManualObservation: true,
        requireVideoReference: true,
        manualVideoTolerance: 0.1
      }
    })

    expect(hits.some((item) => item.ruleCode === 'WL-C-002')).toBe(true)
    expect(hits.some((item) => item.ruleCode === 'WL-V-001')).toBe(false)
  })

  it('creates boundary and hourly delta hits for abnormal chosen value', async () => {
    const { HydrologyRuleEngine } = await import('../../src/main/hydrology/rules/rule-engine.js')
    const engine = new HydrologyRuleEngine()

    const hits = engine.run({
      slot: {
        stationId: 'station-4',
        observationType: 'waterLevel',
        slotTime: '2026-05-15 09:00',
        manualValue: 1.5,
        telemetryValue: 1.45,
        chosenValue: 1.5
      },
      previousSlot: {
        stationId: 'station-4',
        observationType: 'waterLevel',
        slotTime: '2026-05-15 08:00',
        chosenValue: 0.8
      },
      stationRules: {
        sectionMinElevation: 0,
        sectionMaxElevation: 1,
        maxHourlyDelta: 0.1
      }
    })

    expect(hits.map((item) => item.ruleCode)).toEqual(['WL-B-002', 'WL-T-001'])
    expect(hits[0].metrics).toMatchObject({
      sectionMaxElevation: 1
    })
    expect(hits[1].metrics).toMatchObject({
      previousChosenValue: 0.8,
      maxHourlyDelta: 0.1
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
