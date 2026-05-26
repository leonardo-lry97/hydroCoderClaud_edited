import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const agentLeftContentPath = path.resolve(__dirname, '../../src/renderer/pages/main/components/agent/AgentLeftContent.vue')
const agentChatTabPath = path.resolve(__dirname, '../../src/renderer/pages/main/components/AgentChatTab.vue')

describe('external IM session-created focus wiring', () => {
  it('focuses the created session instead of only reloading the list', () => {
    const source = fs.readFileSync(agentLeftContentPath, 'utf-8')

    expect(source).toContain('const focusConversationById = async (sessionId) => {')
    expect(source).toContain("emit('select', conv)")

    expect(source).toContain('window.electronAPI.onDingTalkSessionCreated((data) => {')
    expect(source).toContain('window.electronAPI.onWeixinSessionCreated((data) => {')
    expect(source).toContain('window.electronAPI.onFeishuSessionCreated((data) => {')

    expect(source).toContain('focusConversationById(data?.sessionId)')
  })

  it('registers external IM listeners before loading history messages', () => {
    const source = fs.readFileSync(agentChatTabPath, 'utf-8')
    const setupIndex = source.indexOf('setupExternalImMessageListeners()')
    const loadIndex = source.indexOf('await loadMessages()')

    expect(setupIndex).toBeGreaterThan(-1)
    expect(loadIndex).toBeGreaterThan(-1)
    expect(setupIndex).toBeLessThan(loadIndex)
  })
})
