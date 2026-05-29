import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const leftPanelPath = path.resolve(__dirname, '../../src/renderer/pages/main/components/LeftPanel.vue')

describe('LeftPanel reopen session binding sync', () => {
  it('merges reopened session fields back into the selected conversation', () => {
    const source = fs.readFileSync(leftPanelPath, 'utf-8')

    expect(source).toContain('const result = await window.electronAPI.reopenAgentSession(conv.id)')
    expect(source).toContain('Object.assign(conv, result, {')
    expect(source).toContain("status: result.status || 'idle'")
  })
})
