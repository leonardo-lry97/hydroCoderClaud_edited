import { describe, it, expect, beforeEach } from 'vitest'
import Database from '../mocks/better-sqlite3.js'

describe('Hydrology station backend', () => {
  beforeEach(() => {
    globalThis.resetMemoryDB?.()
  })

  it('persists and queries stations via hydrology database', async () => {
    const { HydrologyDatabase } = await import('../../src/main/hydrology/hydrology-database.js')
    const { StationService } = await import('../../src/main/hydrology/station-service.js')

    const db = new HydrologyDatabase({
      userDataPath: 'C:/tmp/cc-desktop-test',
      Database
    })
    db.init()
    const service = new StationService(db)

    const saved = service.saveStation({
      code: 'HD001',
      name: '黄田站',
      basin: '黄田流域',
      observationTypes: ['waterLevel', 'airTemperature']
    })

    expect(saved.id).toBeTruthy()
    expect(saved.code).toBe('HD001')
    expect(service.listStations()).toHaveLength(1)
    expect(service.getStation(saved.id)?.name).toBe('黄田站')
  })

  it('rejects duplicate station codes', async () => {
    const { HydrologyDatabase } = await import('../../src/main/hydrology/hydrology-database.js')
    const { StationService } = await import('../../src/main/hydrology/station-service.js')

    const db = new HydrologyDatabase({
      userDataPath: 'C:/tmp/cc-desktop-test',
      Database
    })
    db.init()
    const service = new StationService(db)

    service.saveStation({
      code: 'HD002',
      name: '东港站',
      observationTypes: ['waterLevel']
    })

    expect(() => service.saveStation({
      code: 'HD002',
      name: '东港二站',
      observationTypes: ['waterLevel']
    })).toThrow('站码已存在')
  })
})
