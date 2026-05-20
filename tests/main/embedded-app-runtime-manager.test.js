import { describe, expect, it } from 'vitest'

describe('EmbeddedAppRuntimeManager', () => {
  it('clears the current session only when it matches the disconnecting session', async () => {
    const { EmbeddedAppRuntimeManager } = await import('../../src/main/agent-platform/embedded-app-runtime-manager.js')
    const manager = new EmbeddedAppRuntimeManager()

    manager.setCurrentSession('hydrology-workbench', 'session-1')

    expect(manager.clearCurrentSessionIfMatches('hydrology-workbench', 'session-2')).toBe(false)
    expect(manager.getCurrentSession('hydrology-workbench')).toBe('session-1')

    expect(manager.clearCurrentSessionIfMatches('hydrology-workbench', 'session-1')).toBe(true)
    expect(manager.getCurrentSession('hydrology-workbench')).toBeNull()
  })
})
