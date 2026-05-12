import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ipcHandlersPath = path.resolve(__dirname, '../../src/main/ipc-handlers.js')
const preloadPath = path.resolve(__dirname, '../../src/preload/preload.js')
const leftPanelPath = path.resolve(__dirname, '../../src/renderer/pages/main/components/LeftPanel.vue')
const notebookTopNavPath = path.resolve(__dirname, '../../src/renderer/pages/notebook/components/NotebookTopNav.vue')
const settingsWorkbenchPath = path.resolve(__dirname, '../../src/renderer/pages/settings-workbench/components/SettingsWorkbenchContent.vue')

describe('embedded app demo wiring', () => {
  it('registers a window route for the embedded app demo', () => {
    const source = fs.readFileSync(ipcHandlersPath, 'utf-8')

    expect(source).toContain("ipcMain.handle('window:openEmbeddedAppDemo'")
    expect(source).toContain("page: 'embedded-app-demo'")
  })

  it('exposes embedded app demo opener in preload', () => {
    const source = fs.readFileSync(preloadPath, 'utf-8')

    expect(source).toContain("openEmbeddedAppDemo: () => ipcRenderer.invoke('window:openEmbeddedAppDemo')")
  })

  it('adds embedded apps as a first-level settings entry in main mode', () => {
    const source = fs.readFileSync(leftPanelPath, 'utf-8')

    expect(source).toContain("t('settingsMenu.embeddedApps')")
    expect(source).toContain("key: 'embedded-apps'")
    expect(source).toContain("children:")
    expect(source).toContain("label: t('embeddedApps.demoTitle')")
    expect(source).toContain("key: 'embedded-app-demo'")
    expect(source).toContain("window.electronAPI.openEmbeddedAppDemo()")
  })

  it('adds embedded apps as a first-level settings entry in notebook mode', () => {
    const source = fs.readFileSync(notebookTopNavPath, 'utf-8')

    expect(source).toContain("t('settingsMenu.embeddedApps')")
    expect(source).toContain("key: 'embedded-apps'")
    expect(source).toContain("children:")
    expect(source).toContain("label: t('embeddedApps.demoTitle')")
    expect(source).toContain("key: 'embedded-app-demo'")
    expect(source).toContain("window.electronAPI.openEmbeddedAppDemo()")
  })

  it('removes embedded apps from settings workbench tabs', () => {
    const source = fs.readFileSync(settingsWorkbenchPath, 'utf-8')

    expect(source).not.toContain("EmbeddedAppsWorkbenchTab")
    expect(source).not.toContain("{ id: 'embeddedApps'")
  })
})
