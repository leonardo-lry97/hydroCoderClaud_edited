const { createIPCHandler } = require('../utils/ipc-utils')

function setupHydrologyHandlers(ipcMain, services = {}) {
  const { stationService, realtimeService } = services
  if (!stationService) {
    console.warn('[IPC] StationService not available, skipping hydrology handlers')
    return
  }

  createIPCHandler(ipcMain, 'hydrology:station:list', async () => {
    return stationService.listStations()
  })

  createIPCHandler(ipcMain, 'hydrology:station:get', async (stationId) => {
    return stationService.getStation(stationId)
  })

  createIPCHandler(ipcMain, 'hydrology:station:save', async (payload) => {
    return stationService.saveStation(payload || {})
  })

  createIPCHandler(ipcMain, 'hydrology:station:delete', async (stationId) => {
    return stationService.deleteStation(stationId)
  })

  createIPCHandler(ipcMain, 'hydrology:realtime:seed', async (stationId) => {
    if (!realtimeService) {
      throw new Error('RealtimeService not available')
    }
    const station = stationService.getStation(stationId)
    if (!station) {
      throw new Error('站点不存在')
    }
    return realtimeService.seedStationObservations(station)
  })

  createIPCHandler(ipcMain, 'hydrology:realtime:listSlots', async (filters = {}) => {
    if (!realtimeService) {
      throw new Error('RealtimeService not available')
    }
    return realtimeService.listRealtimeSlots(filters || {})
  })

  createIPCHandler(ipcMain, 'hydrology:realtime:getSlotDetail', async (slotId) => {
    if (!realtimeService) {
      throw new Error('RealtimeService not available')
    }
    return realtimeService.getRealtimeSlotDetail(slotId)
  })

  createIPCHandler(ipcMain, 'hydrology:realtime:trend', async (filters = {}) => {
    if (!realtimeService) {
      throw new Error('RealtimeService not available')
    }
    return realtimeService.listRealtimeTrend(filters || {})
  })

  createIPCHandler(ipcMain, 'hydrology:realtime:applyCorrection', async (payload = {}) => {
    if (!realtimeService) {
      throw new Error('RealtimeService not available')
    }
    return realtimeService.applyCorrection(payload || {})
  })
}

module.exports = { setupHydrologyHandlers }
