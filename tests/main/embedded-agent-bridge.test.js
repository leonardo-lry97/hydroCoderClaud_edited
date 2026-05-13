import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const preloadPath = path.resolve(__dirname, '../../src/preload/preload.js')
const ipcHandlersPath = path.resolve(__dirname, '../../src/main/ipc-handlers.js')

describe('embedded hydro agent bridge wiring', () => {
  it('exposes hydroAgent and hydroHostTheme in preload', () => {
    const source = fs.readFileSync(preloadPath, 'utf-8')

    expect(source).toContain("contextBridge.exposeInMainWorld('hydroAgent', hydroAgent)")
    expect(source).toContain("contextBridge.exposeInMainWorld('hydroHostTheme', hydroHostTheme)")
    expect(source).toContain("ipcRenderer.invoke('hydro-agent:createSession'")
    expect(source).toContain("ipcRenderer.invoke('hydro-agent:sendMessage'")
    expect(source).toContain("ipcRenderer.invoke('hydro-agent:switchApiProfile'")
    expect(source).toContain("ipcRenderer.invoke('hydro-agent:listDir'")
    expect(source).toContain("ipcRenderer.invoke('hydro-agent:searchFiles'")
    expect(source).toContain("ipcRenderer.invoke('embedded-app:getPreferences'")
    expect(source).toContain("ipcRenderer.invoke('embedded-app:updatePreferences'")
    expect(source).toContain('hydroAgentState.defaultCwd = result?.defaultCwd || null')
  })

  it('registers embedded hydro-agent ipc routes in the main process', () => {
    const source = fs.readFileSync(ipcHandlersPath, 'utf-8')

    expect(source).toContain("ipcMain.handle('hydro-agent:connect'")
    expect(source).toContain("ipcMain.handle('hydro-agent:disconnect'")
    expect(source).toContain("ipcMain.handle('hydro-agent:createSession'")
    expect(source).toContain("ipcMain.handle('hydro-agent:listSessions'")
    expect(source).toContain("ipcMain.handle('hydro-agent:sendMessage'")
    expect(source).toContain("ipcMain.handle('hydro-agent:switchApiProfile'")
    expect(source).toContain("ipcMain.handle('hydro-agent:respondInteraction'")
    expect(source).toContain("ipcMain.handle('hydro-agent:listDir'")
    expect(source).toContain("ipcMain.handle('hydro-agent:searchFiles'")
    expect(source).toContain("ipcMain.handle('embedded-app:getPreferences'")
    expect(source).toContain("ipcMain.handle('embedded-app:updatePreferences'")
    expect(source).toContain("sender.send('hydro-agent:event', payload)")
    expect(source).toContain("path.join(app.getPath('userData'), 'embedded-apps', safeAppId, 'workspace')")
    expect(source).toContain('defaultCwd: client.defaultCwd')
    expect(source).toContain(': normalizedClient.defaultCwd')
  })
})
