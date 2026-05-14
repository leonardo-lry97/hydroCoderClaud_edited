export const STATION_STATUSES = ['active', 'maintenance', 'disabled']

export const OBSERVATION_TYPES = {
  waterLevel: 'waterLevel',
  airTemperature: 'airTemperature'
}

export const DEFAULT_STATION_RULES = {
  waterLevel: {
    min: 0,
    max: 50,
    maxHourlyChange: 2,
    spikeThreshold: 1.5,
    compareVideoOcr: true
  },
  airTemperature: {
    min: -50,
    max: 60,
    maxHourlyChange: 8,
    spikeThreshold: 6
  }
}

export const DEFAULT_STATION_SCHEDULE = {
  waterLevelStatAt: '00:00',
  meteorologicalStatAt: '20:00',
  waterLevelExcerptEnabled: true
}

export function createEmptyStation() {
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
    validationRules: structuredClone(DEFAULT_STATION_RULES)
  }
}

export function normalizeStation(rawStation = {}) {
  const station = {
    ...createEmptyStation(),
    ...rawStation,
    dataSources: {
      ...createEmptyStation().dataSources,
      ...(rawStation.dataSources || {})
    },
    schedule: {
      ...DEFAULT_STATION_SCHEDULE,
      ...(rawStation.schedule || {})
    },
    validationRules: {
      waterLevel: {
        ...DEFAULT_STATION_RULES.waterLevel,
        ...(rawStation.validationRules?.waterLevel || {})
      },
      airTemperature: {
        ...DEFAULT_STATION_RULES.airTemperature,
        ...(rawStation.validationRules?.airTemperature || {})
      }
    }
  }

  station.id = station.id || `st-${station.code || Date.now()}`
  station.observationTypes = Array.isArray(station.observationTypes)
    ? station.observationTypes.filter((type) => Object.values(OBSERVATION_TYPES).includes(type))
    : [OBSERVATION_TYPES.waterLevel]
  station.status = STATION_STATUSES.includes(station.status) ? station.status : 'active'
  station.longitude = station.longitude === '' ? '' : Number(station.longitude)
  station.latitude = station.latitude === '' ? '' : Number(station.latitude)
  station.elevation = station.elevation === '' ? '' : Number(station.elevation)
  return station
}

export function validateStation(station) {
  const errors = []
  if (!station.code?.trim()) errors.push('站码不能为空')
  if (!station.name?.trim()) errors.push('站名不能为空')
  if (!station.observationTypes?.length) errors.push('至少选择一个观测类别')
  if (station.longitude !== '' && (Number.isNaN(station.longitude) || station.longitude < -180 || station.longitude > 180)) {
    errors.push('经度必须在 -180 到 180 之间')
  }
  if (station.latitude !== '' && (Number.isNaN(station.latitude) || station.latitude < -90 || station.latitude > 90)) {
    errors.push('纬度必须在 -90 到 90 之间')
  }
  return errors
}

export function describeObservationTypes(types = []) {
  const labels = {
    [OBSERVATION_TYPES.waterLevel]: '水位',
    [OBSERVATION_TYPES.airTemperature]: '气温'
  }
  return types.map((type) => labels[type] || type).join(' / ')
}

export function describeStatus(status) {
  return {
    active: '在线',
    maintenance: '维护中',
    disabled: '停用'
  }[status] || status
}
