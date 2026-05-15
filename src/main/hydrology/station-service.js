const STATION_STATUSES = ['active', 'maintenance', 'disabled']
const OBSERVATION_TYPES = {
  waterLevel: 'waterLevel',
  airTemperature: 'airTemperature'
}

const DEFAULT_STATION_RULES = {
  waterLevel: {
    sectionMinElevation: 0,
    sectionMaxElevation: 50,
    maxHourlyDelta: 0.1,
    manualVideoTolerance: 0.1,
    requireManualObservation: true,
    requireVideoReference: true
  },
  airTemperature: {
    min: -50,
    max: 60,
    maxHourlyChange: 8,
    spikeThreshold: 6
  }
}

const DEFAULT_STATION_SCHEDULE = {
  waterLevelStatAt: '00:00',
  meteorologicalStatAt: '20:00',
  waterLevelExcerptEnabled: true
}

function createDefaultStation() {
  return {
    id: '',
    code: '',
    name: '',
    basin: '',
    river: '',
    longitude: '',
    latitude: '',
    elevation: '',
    observationTypes: [OBSERVATION_TYPES.waterLevel],
    status: 'active',
    timezone: 'Asia/Shanghai',
    dataSources: {
      manual: true,
      videoOcr: false,
      telemetry: false
    },
    schedule: { ...DEFAULT_STATION_SCHEDULE },
    validationRules: {
      waterLevel: { ...DEFAULT_STATION_RULES.waterLevel },
      airTemperature: { ...DEFAULT_STATION_RULES.airTemperature }
    }
  }
}

function normalizeNumber(value) {
  if (value === '' || value == null) return ''
  const normalized = Number(value)
  return Number.isNaN(normalized) ? value : normalized
}

function normalizeStation(rawStation = {}) {
  const defaults = createDefaultStation()
  const rawWaterLevelRules = rawStation.validationRules?.waterLevel || {}
  const normalizedWaterLevelRules = {
    ...DEFAULT_STATION_RULES.waterLevel,
    ...rawWaterLevelRules,
    sectionMinElevation: normalizeNumber(
      rawWaterLevelRules.sectionMinElevation ?? rawWaterLevelRules.min ?? DEFAULT_STATION_RULES.waterLevel.sectionMinElevation
    ),
    sectionMaxElevation: normalizeNumber(
      rawWaterLevelRules.sectionMaxElevation ?? rawWaterLevelRules.max ?? DEFAULT_STATION_RULES.waterLevel.sectionMaxElevation
    ),
    maxHourlyDelta: normalizeNumber(
      rawWaterLevelRules.maxHourlyDelta ?? rawWaterLevelRules.maxHourlyChange ?? DEFAULT_STATION_RULES.waterLevel.maxHourlyDelta
    ),
    manualVideoTolerance: normalizeNumber(
      rawWaterLevelRules.manualVideoTolerance ?? DEFAULT_STATION_RULES.waterLevel.manualVideoTolerance
    ),
    requireManualObservation: rawWaterLevelRules.requireManualObservation !== false,
    requireVideoReference: rawWaterLevelRules.requireVideoReference ?? rawWaterLevelRules.compareVideoOcr ?? DEFAULT_STATION_RULES.waterLevel.requireVideoReference
  }
  const station = {
    ...defaults,
    ...rawStation,
    dataSources: {
      ...defaults.dataSources,
      ...(rawStation.dataSources || {})
    },
    schedule: {
      ...DEFAULT_STATION_SCHEDULE,
      ...(rawStation.schedule || {})
    },
    validationRules: {
      waterLevel: {
        ...normalizedWaterLevelRules
      },
      airTemperature: {
        ...DEFAULT_STATION_RULES.airTemperature,
        ...(rawStation.validationRules?.airTemperature || {})
      }
    }
  }

  station.id = typeof station.id === 'string' && station.id.trim()
    ? station.id.trim()
    : `st-${String(station.code || Date.now()).trim()}`
  station.code = String(station.code || '').trim()
  station.name = String(station.name || '').trim()
  station.basin = String(station.basin || '').trim()
  station.river = String(station.river || '').trim()
  station.timezone = String(station.timezone || 'Asia/Shanghai').trim() || 'Asia/Shanghai'
  station.status = STATION_STATUSES.includes(station.status) ? station.status : 'active'
  station.observationTypes = Array.isArray(station.observationTypes)
    ? station.observationTypes.filter((type) => Object.values(OBSERVATION_TYPES).includes(type))
    : [OBSERVATION_TYPES.waterLevel]
  station.longitude = normalizeNumber(station.longitude)
  station.latitude = normalizeNumber(station.latitude)
  station.elevation = normalizeNumber(station.elevation)

  return station
}

function validateStation(station) {
  const errors = []
  if (!station.code) errors.push('站码不能为空')
  if (!station.name) errors.push('站名不能为空')
  if (!station.observationTypes?.length) errors.push('至少选择一个观测类别')

  if (station.longitude !== '' && (Number.isNaN(station.longitude) || station.longitude < -180 || station.longitude > 180)) {
    errors.push('经度必须在 -180 到 180 之间')
  }
  if (station.latitude !== '' && (Number.isNaN(station.latitude) || station.latitude < -90 || station.latitude > 90)) {
    errors.push('纬度必须在 -90 到 90 之间')
  }

  return errors
}

function parseStationRow(row) {
  if (!row) return null

  const parsed = normalizeStation({
    id: row.id,
    code: row.code,
    name: row.name,
    basin: row.basin,
    river: row.river,
    longitude: row.longitude ?? '',
    latitude: row.latitude ?? '',
    elevation: row.elevation ?? '',
    observationTypes: JSON.parse(row.observation_types || '[]'),
    status: row.status,
    timezone: row.timezone,
    dataSources: JSON.parse(row.data_sources || '{}'),
    schedule: JSON.parse(row.schedule || '{}'),
    validationRules: JSON.parse(row.validation_rules || '{}')
  })

  return {
    ...parsed,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  }
}

class StationService {
  constructor(hydrologyDatabase) {
    this.db = hydrologyDatabase
  }

  listStations() {
    return this.db.listStations().map(parseStationRow)
  }

  getStation(id) {
    return parseStationRow(this.db.getStationById(id))
  }

  saveStation(input) {
    const explicitId = typeof input?.id === 'string' ? input.id.trim() : ''
    const station = normalizeStation(input)
    const errors = validateStation(station)
    if (errors.length > 0) {
      const error = new Error(errors.join('；'))
      error.code = 'VALIDATION_ERROR'
      throw error
    }

    const existing = explicitId
      ? this.db.getStationById(explicitId)
      : null
    const duplicated = this.db.getStationByCode(station.code)
    if (duplicated && (!existing || duplicated.id !== existing.id)) {
      const error = new Error('站码已存在')
      error.code = 'DUPLICATE_CODE'
      throw error
    }

    const saved = existing
      ? this.db.updateStation(station.id, station)
      : this.db.createStation(station)

    return parseStationRow(saved)
  }

  deleteStation(id) {
    if (!id || typeof id !== 'string') {
      const error = new Error('站点 ID 无效')
      error.code = 'INVALID_ID'
      throw error
    }

    return this.db.deleteStation(id.trim())
  }
}

module.exports = {
  StationService,
  OBSERVATION_TYPES,
  DEFAULT_STATION_RULES,
  DEFAULT_STATION_SCHEDULE,
  normalizeStation,
  validateStation
}
