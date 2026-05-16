import { describe, it, expect, beforeEach } from 'vitest'
import Database from '../mocks/better-sqlite3.js'

function buildTelemetryWindow(slotTime) {
  const slotDate = new Date(`${slotTime.replace(' ', 'T')}:00+08:00`)
  return {
    first: new Date(slotDate.getTime() - 55 * 60 * 1000).toISOString(),
    last: slotDate.toISOString()
  }
}

describe('Hydrology realtime backend', () => {
  beforeEach(() => {
    globalThis.resetMemoryDB?.()
  })

  it('seeds realtime observations and exposes slot detail', async () => {
    const { HydrologyDatabase } = await import('../../src/main/hydrology/hydrology-database.js')
    const { StationService } = await import('../../src/main/hydrology/station-service.js')
    const { RealtimeService } = await import('../../src/main/hydrology/realtime-service.js')
    const { RealtimeDemoSeeder } = await import('../../src/main/hydrology/realtime-demo-seeder.js')

    const db = new HydrologyDatabase({
      userDataPath: 'C:/tmp/cc-desktop-test',
      Database
    })
    db.init()

    const stationService = new StationService(db)
    const realtimeService = new RealtimeService(db)
    const realtimeDemoSeeder = new RealtimeDemoSeeder(realtimeService)
    const station = stationService.saveStation({
      code: 'HD100',
      name: '青溪站',
      observationTypes: ['waterLevel', 'airTemperature'],
      dataSources: {
        manual: true,
        telemetry: true,
        videoOcr: true
      }
    })

    realtimeDemoSeeder.seedStationObservations(station)

    const slots = realtimeService.listRealtimeSlots({
      stationId: station.id,
      observationType: 'waterLevel'
    })

    expect(slots.length).toBe(72)
    expect(slots[0].telemetryValue).not.toBeNull()

    const detail = realtimeService.getRealtimeSlotDetail(slots[0].id)
    const telemetryWindow = buildTelemetryWindow(slots[0].slotTime)
    expect(detail.slot.id).toBe(slots[0].id)
    expect(detail.telemetryObservations.length).toBe(12)
    expect(detail.telemetryObservations[0].observedAt).toBe(telemetryWindow.first)
    expect(detail.telemetryObservations[11].observedAt).toBe(telemetryWindow.last)
    expect(detail.slot.chosenSourceType).toBeTruthy()
    expect(detail.anomalies).toEqual([])
  })

  it('applies manual correction and refreshes chosen slot value', async () => {
    const { HydrologyDatabase } = await import('../../src/main/hydrology/hydrology-database.js')
    const { StationService } = await import('../../src/main/hydrology/station-service.js')
    const { RealtimeService } = await import('../../src/main/hydrology/realtime-service.js')
    const { RealtimeDemoSeeder } = await import('../../src/main/hydrology/realtime-demo-seeder.js')

    const db = new HydrologyDatabase({
      userDataPath: 'C:/tmp/cc-desktop-test',
      Database
    })
    db.init()

    const stationService = new StationService(db)
    const realtimeService = new RealtimeService(db)
    const realtimeDemoSeeder = new RealtimeDemoSeeder(realtimeService)
    const station = stationService.saveStation({
      code: 'HD101',
      name: '东港站',
      observationTypes: ['waterLevel'],
      dataSources: {
        manual: true,
        telemetry: true,
        videoOcr: false
      }
    })

    realtimeDemoSeeder.seedStationObservations(station)
    const slot = realtimeService.listRealtimeSlots({
      stationId: station.id,
      observationType: 'waterLevel'
    })[0]

    const correction = realtimeService.applyCorrection({
      stationId: station.id,
      observationType: 'waterLevel',
      targetTime: slot.slotTime,
      beforeValue: slot.chosenValue,
      afterValue: 4.99,
      reason: '人工复核确认录入错误'
    })

    expect(correction.afterValue).toBe(4.99)

    const refreshed = realtimeService.listRealtimeSlots({
      stationId: station.id,
      observationType: 'waterLevel'
    }).find((item) => item.id === slot.id)

    expect(refreshed.chosenValue).toBe(slot.manualValue)
    expect(refreshed.correctedValue).toBe(4.99)
    expect(refreshed.hasAnomaly).toBe(false)
    const detail = realtimeService.getRealtimeSlotDetail(slot.id)
    expect(detail.slot.manualValue).toBe(slot.manualValue)
    expect(detail.slot.correctedValue).toBe(4.99)
    expect(detail.slot.chosenSourceType).toBe('manual')
    expect(detail.manualObservation?.value).toBe(slot.manualValue)
    expect(detail.correctedObservation?.value).toBe(4.99)
    expect(detail.anomalies.some((item) => item.anomalyType === 'water_level_hourly_delta_exceeded')).toBe(false)
  })

  it('supports realtime filters and trend queries', async () => {
    const { HydrologyDatabase } = await import('../../src/main/hydrology/hydrology-database.js')
    const { StationService } = await import('../../src/main/hydrology/station-service.js')
    const { RealtimeService } = await import('../../src/main/hydrology/realtime-service.js')
    const { RealtimeDemoSeeder } = await import('../../src/main/hydrology/realtime-demo-seeder.js')

    const db = new HydrologyDatabase({
      userDataPath: 'C:/tmp/cc-desktop-test',
      Database
    })
    db.init()

    const stationService = new StationService(db)
    const realtimeService = new RealtimeService(db)
    const realtimeDemoSeeder = new RealtimeDemoSeeder(realtimeService)
    const station = stationService.saveStation({
      code: 'HD102',
      name: '白石站',
      observationTypes: ['waterLevel'],
      dataSources: {
        manual: true,
        telemetry: true,
        videoOcr: true
      }
    })

    realtimeDemoSeeder.seedStationObservations(station)
    const slots = realtimeService.listRealtimeSlots({
      stationId: station.id,
      observationType: 'waterLevel'
    }).sort((left, right) => left.slotTime.localeCompare(right.slotTime))

    expect(slots.length).toBeGreaterThan(2)

    const filtered = realtimeService.listRealtimeSlots({
      stationId: station.id,
      observationType: 'waterLevel',
      compareStatus: 'slightly_diff',
      fromTime: slots[1].slotTime,
      toTime: slots[2].slotTime
    })

    expect(filtered).toHaveLength(2)
    expect(filtered.every((item) => item.compareStatus === 'slightly_diff')).toBe(true)

    const slotTrend = realtimeService.listRealtimeTrend({
      stationId: station.id,
      observationType: 'waterLevel',
      fromTime: slots[1].slotTime,
      toTime: slots[2].slotTime,
      viewMode: 'slot'
    })

    expect(slotTrend.series.find((item) => item.sourceType === 'manual')?.points.length).toBe(2)
    expect(slotTrend.series.find((item) => item.sourceType === 'telemetry')?.points.length).toBe(2)

    const rawTrend = realtimeService.listRealtimeTrend({
      stationId: station.id,
      observationType: 'waterLevel',
      fromTime: slots[1].slotTime,
      toTime: slots[2].slotTime,
      viewMode: 'raw'
    })

    expect(rawTrend.series.find((item) => item.sourceType === 'telemetry')?.points.length).toBeGreaterThan(2)
  })

  it('tops up legacy demo data to full three-day coverage', async () => {
    const { HydrologyDatabase } = await import('../../src/main/hydrology/hydrology-database.js')
    const { StationService } = await import('../../src/main/hydrology/station-service.js')
    const { RealtimeService, SOURCE_TYPES } = await import('../../src/main/hydrology/realtime-service.js')
    const { RealtimeDemoSeeder } = await import('../../src/main/hydrology/realtime-demo-seeder.js')

    const db = new HydrologyDatabase({
      userDataPath: 'C:/tmp/cc-desktop-test',
      Database
    })
    db.init()

    const stationService = new StationService(db)
    const realtimeService = new RealtimeService(db)
    const realtimeDemoSeeder = new RealtimeDemoSeeder(realtimeService)
    const station = stationService.saveStation({
      code: 'HD103',
      name: '临江站',
      observationTypes: ['waterLevel'],
      dataSources: {
        manual: true,
        telemetry: true,
        videoOcr: true
      }
    })

    const now = new Date()
    now.setMinutes(0, 0, 0)
    for (let hoursAgo = 3; hoursAgo >= 0; hoursAgo -= 1) {
      const hourDate = new Date(now.getTime() - hoursAgo * 60 * 60 * 1000)
      realtimeService.saveObservation({
        stationId: station.id,
        observationType: 'waterLevel',
        sourceType: SOURCE_TYPES.manual,
        observedAt: hourDate.toISOString(),
        value: Number((5.1 + hoursAgo * 0.02).toFixed(2)),
        unit: 'm'
      })
    }

    expect(realtimeService.listRealtimeSlots({
      stationId: station.id,
      observationType: 'waterLevel'
    })).toHaveLength(4)

    realtimeDemoSeeder.seedStationObservations(station)

    const slots = realtimeService.listRealtimeSlots({
      stationId: station.id,
      observationType: 'waterLevel'
    })

    expect(slots).toHaveLength(72)
    const detail = realtimeService.getRealtimeSlotDetail(slots[0].id)
    const telemetryWindow = buildTelemetryWindow(slots[0].slotTime)
    expect(detail.telemetryObservations).toHaveLength(12)
    expect(detail.telemetryObservations[0].observedAt).toBe(telemetryWindow.first)
    expect(detail.telemetryObservations[11].observedAt).toBe(telemetryWindow.last)
  })

  it('updates source observation and refreshes old/new slot aggregates', async () => {
    const { HydrologyDatabase } = await import('../../src/main/hydrology/hydrology-database.js')
    const { StationService } = await import('../../src/main/hydrology/station-service.js')
    const { RealtimeService, SOURCE_TYPES } = await import('../../src/main/hydrology/realtime-service.js')

    const db = new HydrologyDatabase({
      userDataPath: 'C:/tmp/cc-desktop-test',
      Database
    })
    db.init()

    const stationService = new StationService(db)
    const realtimeService = new RealtimeService(db)
    const station = stationService.saveStation({
      code: 'HD104',
      name: '更新测试站',
      observationTypes: ['waterLevel'],
      dataSources: {
        manual: true,
        telemetry: true,
        videoOcr: true
      }
    })

    const manual = realtimeService.saveObservation({
      stationId: station.id,
      observationType: 'waterLevel',
      sourceType: SOURCE_TYPES.manual,
      observedAt: '2026-05-15T00:00:00.000Z',
      value: 5.1,
      unit: 'm'
    })
    realtimeService.saveObservation({
      stationId: station.id,
      observationType: 'waterLevel',
      sourceType: SOURCE_TYPES.telemetry,
      observedAt: manual.observedAt,
      value: 5.08,
      unit: 'm'
    })

    const slotBefore = realtimeService.listRealtimeSlots({
      stationId: station.id,
      observationType: 'waterLevel'
    }).find((item) => item.slotTime === manual.slotTime)

    expect(slotBefore?.manualValue).toBe(5.1)

    const updated = realtimeService.updateObservation({
      id: manual.id,
      observedAt: '2026-05-15T01:00:00.000Z',
      value: 5.32
    })

    expect(updated.slotTime).not.toBe(manual.slotTime)

    const slotsAfter = realtimeService.listRealtimeSlots({
      stationId: station.id,
      observationType: 'waterLevel'
    })
    const oldSlot = slotsAfter.find((item) => item.slotTime === manual.slotTime)
    const newSlot = slotsAfter.find((item) => item.slotTime === updated.slotTime)

    expect(oldSlot?.manualValue).toBeNull()
    expect(oldSlot?.missingFlags).toContain('missing_manual')
    expect(newSlot?.manualValue).toBe(5.32)
  })

  it('deletes source observation and surfaces missing-source state on rerun', async () => {
    const { HydrologyDatabase } = await import('../../src/main/hydrology/hydrology-database.js')
    const { StationService } = await import('../../src/main/hydrology/station-service.js')
    const { RealtimeService, SOURCE_TYPES } = await import('../../src/main/hydrology/realtime-service.js')

    const db = new HydrologyDatabase({
      userDataPath: 'C:/tmp/cc-desktop-test',
      Database
    })
    db.init()

    const stationService = new StationService(db)
    const realtimeService = new RealtimeService(db)
    const station = stationService.saveStation({
      code: 'HD105',
      name: '删除测试站',
      observationTypes: ['waterLevel'],
      dataSources: {
        manual: true,
        telemetry: true,
        videoOcr: true
      }
    })

    const manual = realtimeService.saveObservation({
      stationId: station.id,
      observationType: 'waterLevel',
      sourceType: SOURCE_TYPES.manual,
      observedAt: '2026-05-15T00:00:00.000Z',
      value: 5.22,
      unit: 'm'
    })
    realtimeService.saveObservation({
      stationId: station.id,
      observationType: 'waterLevel',
      sourceType: SOURCE_TYPES.telemetry,
      observedAt: manual.observedAt,
      value: 5.2,
      unit: 'm'
    })
    realtimeService.saveObservation({
      stationId: station.id,
      observationType: 'waterLevel',
      sourceType: SOURCE_TYPES.videoOcr,
      observedAt: '2026-05-15T00:00:00.000Z',
      value: 5.21,
      unit: 'm'
    })

    const slot = realtimeService.listRealtimeSlots({
      stationId: station.id,
      observationType: 'waterLevel'
    }).find((item) => item.slotTime === manual.slotTime)

    expect(slot?.missingFlags).toEqual([])

    realtimeService.deleteObservation(manual.id)

    const refreshed = realtimeService.listRealtimeSlots({
      stationId: station.id,
      observationType: 'waterLevel'
    }).find((item) => item.slotTime === manual.slotTime)

    expect(refreshed?.manualValue).toBeNull()
    expect(refreshed?.missingFlags).toContain('missing_manual')

    const detail = realtimeService.getRealtimeSlotDetail(refreshed.id)
    expect(detail.manualObservation).toBeNull()
    expect(detail.sourceObservations.some((item) => item.id === manual.id)).toBe(false)
    expect(detail.anomalies.filter((item) => item.anomalyType === 'missing_manual')).toHaveLength(1)

    realtimeService.saveObservation({
      stationId: station.id,
      observationType: 'waterLevel',
      sourceType: SOURCE_TYPES.manual,
      observedAt: manual.observedAt,
      value: 5.24,
      unit: 'm'
    })

    const restored = realtimeService.listRealtimeSlots({
      stationId: station.id,
      observationType: 'waterLevel'
    }).find((item) => item.slotTime === manual.slotTime)
    const restoredDetail = realtimeService.getRealtimeSlotDetail(restored.id)

    expect(restoredDetail.manualObservation?.value).toBe(5.24)
    expect(restoredDetail.anomalies.some((item) => item.anomalyType === 'missing_manual')).toBe(false)
  })

  it('clears slot telemetry representative value when the top-of-hour telemetry is deleted', async () => {
    const { HydrologyDatabase } = await import('../../src/main/hydrology/hydrology-database.js')
    const { StationService } = await import('../../src/main/hydrology/station-service.js')
    const { RealtimeService, SOURCE_TYPES } = await import('../../src/main/hydrology/realtime-service.js')

    const db = new HydrologyDatabase({
      userDataPath: 'C:/tmp/cc-desktop-test',
      Database
    })
    db.init()

    const stationService = new StationService(db)
    const realtimeService = new RealtimeService(db)
    const station = stationService.saveStation({
      code: 'HD106',
      name: '遥测代表值站',
      observationTypes: ['waterLevel'],
      dataSources: {
        manual: false,
        telemetry: true,
        videoOcr: true
      }
    })

    const slotAnchor = new Date('2026-05-15T22:00:00+08:00')
    for (let minutesBefore = 55; minutesBefore >= 0; minutesBefore -= 5) {
      const observedAt = new Date(slotAnchor.getTime() - minutesBefore * 60 * 1000)
      realtimeService.saveObservation({
        stationId: station.id,
        observationType: 'waterLevel',
        sourceType: SOURCE_TYPES.telemetry,
        observedAt: observedAt.toISOString(),
        slotTime: '2026-05-15 22:00',
        value: Number((7 + (55 - minutesBefore) * 0.01).toFixed(2)),
        unit: 'm'
      })
    }
    realtimeService.saveObservation({
      stationId: station.id,
      observationType: 'waterLevel',
      sourceType: SOURCE_TYPES.videoOcr,
      observedAt: '2026-05-15T22:02:00+08:00',
      slotTime: '2026-05-15 22:00',
      value: 7.08,
      unit: 'm'
    })

    const slotBefore = realtimeService.listRealtimeSlots({
      stationId: station.id,
      observationType: 'waterLevel'
    })[0]
    expect(slotBefore.telemetryValue).toBe(7.55)
    expect(slotBefore.chosenValue).toBe(7.55)

    const detailBefore = realtimeService.getRealtimeSlotDetail(slotBefore.id)
    const topOfHourTelemetry = detailBefore.telemetryObservations.find((item) => item.observedAt === '2026-05-15T14:00:00.000Z')
    expect(topOfHourTelemetry?.value).toBe(7.55)

    realtimeService.deleteObservation(topOfHourTelemetry.id)

    const slotAfter = realtimeService.listRealtimeSlots({
      stationId: station.id,
      observationType: 'waterLevel'
    })[0]
    expect(slotAfter.telemetryValue).toBeNull()
    expect(slotAfter.chosenValue).toBe(7.08)
    expect(slotAfter.missingFlags).toContain('missing_telemetry')

    const detailAfter = realtimeService.getRealtimeSlotDetail(slotAfter.id)
    expect(detailAfter.telemetryObservations).toHaveLength(11)
    expect(detailAfter.telemetryObservations.some((item) => item.observedAt === '2026-05-15T14:00:00.000Z')).toBe(false)
  })

  it('deletes slot-level non-telemetry sources without removing telemetry detail rows', async () => {
    const { HydrologyDatabase } = await import('../../src/main/hydrology/hydrology-database.js')
    const { StationService } = await import('../../src/main/hydrology/station-service.js')
    const { RealtimeService, SOURCE_TYPES } = await import('../../src/main/hydrology/realtime-service.js')

    const db = new HydrologyDatabase({
      userDataPath: 'C:/tmp/cc-desktop-test',
      Database
    })
    db.init()

    const stationService = new StationService(db)
    const realtimeService = new RealtimeService(db)
    const station = stationService.saveStation({
      code: 'HD107',
      name: '时槽删除站',
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
      observedAt: '2026-05-15T00:00:00.000Z',
      slotTime: '2026-05-15 08:00',
      value: 6.2,
      unit: 'm'
    })
    realtimeService.saveObservation({
      stationId: station.id,
      observationType: 'waterLevel',
      sourceType: SOURCE_TYPES.videoOcr,
      observedAt: '2026-05-15T00:02:00.000Z',
      slotTime: '2026-05-15 08:00',
      value: 6.21,
      unit: 'm'
    })
    for (let minutesBefore = 55; minutesBefore >= 0; minutesBefore -= 5) {
      const observedAt = new Date(new Date('2026-05-15T08:00:00+08:00').getTime() - minutesBefore * 60 * 1000)
      realtimeService.saveObservation({
        stationId: station.id,
        observationType: 'waterLevel',
        sourceType: SOURCE_TYPES.telemetry,
        observedAt: observedAt.toISOString(),
        slotTime: '2026-05-15 08:00',
        value: Number((6 + (55 - minutesBefore) * 0.01).toFixed(2)),
        unit: 'm'
      })
    }

    const beforeSlot = realtimeService.listRealtimeSlots({
      stationId: station.id,
      observationType: 'waterLevel'
    })[0]
    expect(beforeSlot.manualValue).toBe(6.2)
    expect(beforeSlot.videoOcrValue).toBe(6.21)
    expect(beforeSlot.telemetryValue).not.toBeNull()

    const deletion = realtimeService.deleteSlotObservations({
      stationId: station.id,
      observationType: 'waterLevel',
      slotTime: '2026-05-15 08:00'
    })

    expect(deletion.deletedCount).toBe(2)

    const afterSlot = realtimeService.listRealtimeSlots({
      stationId: station.id,
      observationType: 'waterLevel'
    })[0]
    expect(afterSlot.manualValue).toBeNull()
    expect(afterSlot.videoOcrValue).toBeNull()
    expect(afterSlot.telemetryValue).not.toBeNull()
    expect(afterSlot.chosenValue).toBe(afterSlot.telemetryValue)

    const detail = realtimeService.getRealtimeSlotDetail(afterSlot.id)
    expect(detail.manualObservation).toBeNull()
    expect(detail.videoOcrObservation).toBeNull()
    expect(detail.telemetryObservations).toHaveLength(12)
  })
})
