import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const viewPath = path.resolve(__dirname, '../../src/renderer/pages/global-settings/components/GlobalSettingsContent.vue')

describe('GlobalSettingsContent message queue reset', () => {
  it('reuses message queue persistence during reset', () => {
    const source = fs.readFileSync(viewPath, 'utf-8')

    expect(source).toContain('const persistMessageQueueSetting = async (enabled) => {')
    expect(source).toContain('const handleQueueToggle = async (enabled) => {')
    expect(source).toContain('await persistMessageQueueSetting(enabled)')
    expect(source).toContain('await persistMessageQueueSetting(DEFAULTS.messageQueue)')
  })
})
