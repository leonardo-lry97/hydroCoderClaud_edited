import { describe, expect, it } from 'vitest'

const stationModel = await import('../../src/renderer/pages/hydrology-workbench/station-model.js')

describe('hydrology station model', () => {
  it('normalizes station defaults for schedules, sources, and rules', () => {
    const station = stationModel.normalizeStation({
      code: 'QX001',
      name: '青溪站'
    })

    expect(station.id).toBe('st-QX001')
    expect(station.status).toBe('active')
    expect(station.observationTypes).toEqual([stationModel.OBSERVATION_TYPES.waterLevel])
    expect(station.schedule.waterLevelStatAt).toBe('00:00')
    expect(station.schedule.meteorologicalStatAt).toBe('20:00')
    expect(station.validationRules.waterLevel.sectionMinElevation).toBe(0)
    expect(station.validationRules.waterLevel.sectionMaxElevation).toBe(50)
    expect(station.validationRules.waterLevel.maxHourlyDelta).toBe(0.1)
    expect(station.validationRules.waterLevel.manualVideoTolerance).toBe(0.1)
    expect(station.validationRules.waterLevel.requireManualObservation).toBe(true)
    expect(station.validationRules.waterLevel.requireVideoReference).toBe(true)
    expect(station).not.toHaveProperty('region')
  })

  it('maps legacy water-level rule fields into the new rule profile', () => {
    const station = stationModel.normalizeStation({
      code: 'QX002',
      name: '兼容站',
      validationRules: {
        waterLevel: {
          min: 1.2,
          max: 8.8,
          maxHourlyChange: 0.35,
          compareVideoOcr: false
        }
      }
    })

    expect(station.validationRules.waterLevel.sectionMinElevation).toBe(1.2)
    expect(station.validationRules.waterLevel.sectionMaxElevation).toBe(8.8)
    expect(station.validationRules.waterLevel.maxHourlyDelta).toBe(0.35)
    expect(station.validationRules.waterLevel.requireVideoReference).toBe(false)
  })

  it('validates required station identity and coordinate bounds', () => {
    const station = stationModel.normalizeStation({
      code: '',
      name: '',
      longitude: 190,
      latitude: -91,
      observationTypes: []
    })

    expect(stationModel.validateStation(station)).toEqual([
      '站码不能为空',
      '站名不能为空',
      '至少选择一个观测类别',
      '经度必须在 -180 到 180 之间',
      '纬度必须在 -90 到 90 之间'
    ])
  })

  it('describes station type and status for the operator UI', () => {
    expect(stationModel.describeObservationTypes([
      stationModel.OBSERVATION_TYPES.waterLevel,
      stationModel.OBSERVATION_TYPES.airTemperature
    ])).toBe('水位 / 气温')
    expect(stationModel.describeStatus('maintenance')).toBe('维护中')
  })
})
