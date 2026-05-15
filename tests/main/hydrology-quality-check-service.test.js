import { beforeEach, describe, expect, it } from 'vitest'
import Database from '../mocks/better-sqlite3.js'

describe('Hydrology quality check service', () => {
  beforeEach(() => {
    globalThis.resetMemoryDB?.()
  })

  it('runs station quality check and returns aggregated summary', async () => {
    const { HydrologyDatabase } = await import('../../src/main/hydrology/hydrology-database.js')
    const { StationService } = await import('../../src/main/hydrology/station-service.js')
    const { RealtimeService, SOURCE_TYPES } = await import('../../src/main/hydrology/realtime-service.js')
    const { ReviewTaskService } = await import('../../src/main/hydrology/review-task-service.js')
    const { QualityCheckService } = await import('../../src/main/hydrology/quality-check-service.js')

    const db = new HydrologyDatabase({
      userDataPath: 'C:/tmp/cc-desktop-test',
      Database
    })
    db.init()

    const stationService = new StationService(db)
    const reviewTaskService = new ReviewTaskService(db)
    const realtimeService = new RealtimeService(db, { reviewTaskService })
    const qualityCheckService = new QualityCheckService({ stationService, realtimeService })
    const station = stationService.saveStation({
      code: 'HD300',
      name: '手工检查站',
      observationTypes: ['waterLevel'],
      dataSources: {
        manual: true,
        telemetry: true,
        videoOcr: true
      }
    })

    realtimeService.saveObservation({
      stationId: station.id,
      observationType: 'waterLevel',
      sourceType: SOURCE_TYPES.manual,
      observedAt: '2026-05-14T00:00:00.000Z',
      slotTime: '2026-05-14 08:00',
      value: 5,
      unit: 'm'
    })
    realtimeService.saveObservation({
      stationId: station.id,
      observationType: 'waterLevel',
      sourceType: SOURCE_TYPES.videoOcr,
      observedAt: '2026-05-14T00:02:00.000Z',
      slotTime: '2026-05-14 08:00',
      value: 5.3,
      unit: 'm'
    })

    const result = qualityCheckService.runStationQualityCheck({
      stationId: station.id,
      observationType: 'waterLevel'
    })

    expect(result.checkedSlotCount).toBe(1)
    expect(result.hitCount).toBeGreaterThan(0)
    expect(result.stationCode).toBe('HD300')
    expect(result.stationName).toBe('手工检查站')
    expect(result.hitRuleCodes).toContain('WL-V-001')
    expect(result.hitsByRuleCode['WL-V-001']).toBeGreaterThan(0)
    expect(result.hitsBySeverity.warning).toBeGreaterThan(0)
    expect(result.slotResults[0].slotId).toBeTruthy()
    expect(result.slotResults[0].slot?.chosenValue).toBe(5)
    expect(result.slotResults[0].hitRuleCodes).toContain('WL-V-001')
    expect(result.slotResults[0].hits.some((item) => item.ruleCode === 'WL-V-001')).toBe(true)
    expect(result.slotResults[0].ruleEvaluations.some((item) => item.ruleCode === 'WL-V-001' && item.status === 'hit')).toBe(true)
    expect(result.slotResults[0].ruleEvaluations.some((item) => item.ruleCode === 'WL-B-001')).toBe(true)
  })

  it('keeps missing-manual hit active when slot only has corrected chosen value', async () => {
    const { HydrologyDatabase } = await import('../../src/main/hydrology/hydrology-database.js')
    const { StationService } = await import('../../src/main/hydrology/station-service.js')
    const { RealtimeService, SOURCE_TYPES } = await import('../../src/main/hydrology/realtime-service.js')
    const { ReviewTaskService } = await import('../../src/main/hydrology/review-task-service.js')
    const { QualityCheckService } = await import('../../src/main/hydrology/quality-check-service.js')

    const db = new HydrologyDatabase({
      userDataPath: 'C:/tmp/cc-desktop-test',
      Database
    })
    db.init()

    const stationService = new StationService(db)
    const reviewTaskService = new ReviewTaskService(db)
    const realtimeService = new RealtimeService(db, { reviewTaskService })
    const qualityCheckService = new QualityCheckService({ stationService, realtimeService })
    const station = stationService.saveStation({
      code: 'HD301',
      name: '修正语义站',
      observationTypes: ['waterLevel'],
      dataSources: {
        manual: true,
        telemetry: true,
        videoOcr: true
      }
    })

    realtimeService.saveObservation({
      stationId: station.id,
      observationType: 'waterLevel',
      sourceType: SOURCE_TYPES.telemetry,
      observedAt: '2026-05-14T00:00:00.000Z',
      slotTime: '2026-05-14 09:00',
      value: 4.9,
      unit: 'm'
    })
    realtimeService.saveObservation({
      stationId: station.id,
      observationType: 'waterLevel',
      sourceType: SOURCE_TYPES.videoOcr,
      observedAt: '2026-05-14T00:02:00.000Z',
      slotTime: '2026-05-14 09:00',
      value: 4.91,
      unit: 'm'
    })
    realtimeService.saveObservation({
      stationId: station.id,
      observationType: 'waterLevel',
      sourceType: SOURCE_TYPES.corrected,
      observedAt: '2026-05-14T00:03:00.000Z',
      slotTime: '2026-05-14 09:00',
      value: 4.92,
      unit: 'm'
    })

    const result = qualityCheckService.runStationQualityCheck({
      stationId: station.id,
      observationType: 'waterLevel'
    })

    expect(result.checkedSlotCount).toBe(1)
    expect(result.hitRuleCodes).toContain('WL-C-002')
    expect(result.hitRuleCodes).not.toContain('WL-V-001')
    expect(result.slotResults[0].slot.manualValue).toBeNull()
    expect(result.slotResults[0].slot.correctedValue).toBe(4.92)
    expect(result.slotResults[0].slot.chosenValue).toBe(4.92)
    expect(result.slotResults[0].hits.some((item) => item.ruleCode === 'WL-C-002')).toBe(true)
    expect(result.slotResults[0].hits.some((item) => item.ruleCode === 'WL-V-001')).toBe(false)
    expect(result.slotResults[0].ruleEvaluations.some((item) => item.ruleCode === 'WL-C-002' && item.status === 'hit')).toBe(true)
    expect(result.slotResults[0].ruleEvaluations.some((item) => item.ruleCode === 'WL-V-001' && item.status === 'skipped')).toBe(true)
  })
})
