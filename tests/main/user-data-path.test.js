import { describe, it, expect } from 'vitest'

const { getStableUserDataPath } = require('../../src/main/utils/user-data-path')

describe('getStableUserDataPath', () => {
  it('uses cc-desktop under APPDATA on Windows', () => {
    const result = getStableUserDataPath('win32', { APPDATA: 'C:\\Users\\demo\\AppData\\Roaming' }, 'C:\\Users\\demo')
    expect(result).toBe('C:\\Users\\demo\\AppData\\Roaming\\cc-desktop')
  })

  it('uses Application Support on macOS', () => {
    const result = getStableUserDataPath('darwin', {}, '/Users/demo')
    expect(result).toBe('/Users/demo/Library/Application Support/cc-desktop')
  })

  it('uses XDG config on Linux when provided', () => {
    const result = getStableUserDataPath('linux', { XDG_CONFIG_HOME: '/tmp/xdg-config' }, '/home/demo')
    expect(result).toBe('/tmp/xdg-config/cc-desktop')
  })
})
