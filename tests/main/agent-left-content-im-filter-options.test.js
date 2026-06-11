import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const agentLeftContentPath = path.resolve(__dirname, '../../src/renderer/pages/main/components/agent/AgentLeftContent.vue')

describe('AgentLeftContent IM filter options', () => {
  it('does not expose personal weixin in the source filter menu', () => {
    const source = fs.readFileSync(agentLeftContentPath, 'utf-8')

    expect(source).toContain("const PERSONAL_WEIXIN_ENABLED = false")
    expect(source).toContain("const sourceMenuTypes = ['feishu', 'dingtalk', 'enterprise-weixin']")
    expect(source).not.toContain("const sourceMenuTypes = ['feishu', 'dingtalk', 'weixin', 'enterprise-weixin']")
  })
})
