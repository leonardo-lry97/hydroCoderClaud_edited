import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    requestSingleInstanceLock: vi.fn(() => true),
    on: vi.fn(),
    quit: vi.fn()
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => [])
  }
}))

describe('single-instance', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('quits the current process when the single-instance lock cannot be acquired', async () => {
    const on = vi.fn()
    const quit = vi.fn()
    const requestSingleInstanceLock = vi.fn(() => false)
    const { setupSingleInstanceLock } = await import('../../src/main/single-instance.js')

    const result = setupSingleInstanceLock({
      appInstance: {
        requestSingleInstanceLock,
        on,
        quit
      },
      logger: { log: vi.fn() }
    })

    expect(result).toBe(false)
    expect(quit).toHaveBeenCalledOnce()
    expect(on).not.toHaveBeenCalled()
  })

  it('registers a second-instance handler after acquiring the lock', async () => {
    const on = vi.fn()
    const requestSingleInstanceLock = vi.fn(() => true)
    const secondInstanceSpy = vi.fn()
    const { setupSingleInstanceLock } = await import('../../src/main/single-instance.js')

    const result = setupSingleInstanceLock({
      appInstance: {
        requestSingleInstanceLock,
        on,
        quit: vi.fn()
      },
      onSecondInstance: secondInstanceSpy,
      logger: { log: vi.fn() }
    })

    expect(result).toBe(true)
    expect(on).toHaveBeenCalledWith('second-instance', expect.any(Function))

    const handler = on.mock.calls[0][1]
    const payload = { event: {}, commandLine: ['electron', '.'], workingDirectory: 'C:/app' }
    handler(payload.event, payload.commandLine, payload.workingDirectory)

    expect(secondInstanceSpy).toHaveBeenCalledWith(payload)
  })

  it('shows the existing main window when a second instance is launched', async () => {
    const showMainWindow = vi.fn()
    const { restoreOrCreateMainWindow } = await import('../../src/main/single-instance.js')

    const result = restoreOrCreateMainWindow({
      trayController: { showMainWindow },
      getMainWindow: () => ({
        isDestroyed: () => false
      }),
      BrowserWindowClass: {
        getAllWindows: vi.fn(() => [])
      },
      createWindow: vi.fn(),
      resetCleanupState: vi.fn(),
      restartPowerSaveBlocker: vi.fn(),
      rebindMainWindowReferences: vi.fn(),
      logger: { log: vi.fn() }
    })

    expect(result).toBe('show-existing-window')
    expect(showMainWindow).toHaveBeenCalledOnce()
  })

  it('focuses a surviving window when the mainWindow reference is stale', async () => {
    const fallbackWindow = {
      isDestroyed: vi.fn(() => false),
      isMinimized: vi.fn(() => true),
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn()
    }
    const { restoreOrCreateMainWindow } = await import('../../src/main/single-instance.js')

    const result = restoreOrCreateMainWindow({
      trayController: { showMainWindow: vi.fn() },
      getMainWindow: () => null,
      BrowserWindowClass: {
        getAllWindows: vi.fn(() => [fallbackWindow])
      },
      createWindow: vi.fn(),
      resetCleanupState: vi.fn(),
      restartPowerSaveBlocker: vi.fn(),
      rebindMainWindowReferences: vi.fn(),
      logger: { log: vi.fn() }
    })

    expect(result).toBe('show-existing-secondary-window')
    expect(fallbackWindow.restore).toHaveBeenCalledOnce()
    expect(fallbackWindow.show).toHaveBeenCalledOnce()
    expect(fallbackWindow.focus).toHaveBeenCalledOnce()
  })

  it('recreates the window and rebinds services when no window exists', async () => {
    const createWindow = vi.fn()
    const resetCleanupState = vi.fn()
    const refreshTrayMenu = vi.fn()
    const resetQuitting = vi.fn()
    const restartPowerSaveBlocker = vi.fn()
    const rebindMainWindowReferences = vi.fn()
    const { restoreOrCreateMainWindow } = await import('../../src/main/single-instance.js')

    const result = restoreOrCreateMainWindow({
      trayController: {
        refreshTrayMenu,
        resetQuitting
      },
      getMainWindow: () => null,
      BrowserWindowClass: {
        getAllWindows: vi.fn(() => [])
      },
      createWindow,
      resetCleanupState,
      restartPowerSaveBlocker,
      rebindMainWindowReferences,
      logger: { log: vi.fn() }
    })

    expect(result).toBe('create-new-window')
    expect(resetCleanupState).toHaveBeenCalledOnce()
    expect(resetQuitting).toHaveBeenCalledOnce()
    expect(createWindow).toHaveBeenCalledOnce()
    expect(refreshTrayMenu).toHaveBeenCalledOnce()
    expect(restartPowerSaveBlocker).toHaveBeenCalledOnce()
    expect(rebindMainWindowReferences).toHaveBeenCalledWith({
      notifyAgentSessionsClosed: true,
      restartDingtalk: true
    })
  })
})
