import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

const toolbarPath = path.resolve(__dirname, '../../src/renderer/pages/main/components/agent/ChatInputToolbar.vue')

describe('DingTalk quick send target filter', () => {
  it('does not pre-bind a DingTalk session before sendText', () => {
    const source = fs.readFileSync(toolbarPath, 'utf-8')
    const start = source.indexOf('const sendDingTalkQuickMessage = async () => {')
    const end = source.indexOf('const sendWeixinQuickMessage = async () => {')

    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)

    const sendBlock = source.slice(start, end)
    expect(sendBlock).not.toContain('bindSessionToDingTalkTarget')
    expect(sendBlock).toContain('sendDingTalkText')
  })

  it('limits the target dropdown to the existing bound DingTalk target', () => {
    const source = fs.readFileSync(toolbarPath, 'utf-8')
    const start = source.indexOf('const loadDingTalkTargets = async () => {')
    const end = source.indexOf('const loadWeixinTargets = async () => {')

    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)

    const loadBlock = source.slice(start, end)
    expect(loadBlock).toContain('const bindingTargetId = binding?.targetId || binding?.staffId || null')
    expect(loadBlock).toContain('const boundTarget = allTargets.find(target => [target.id, target.staffId, target.userId].includes(bindingTargetId))')
    expect(loadBlock).toContain('dingtalkTargets.value = [boundTarget]')
    expect(loadBlock).toContain('selectedDingTalkTargetId.value = boundTarget.id')
  })
})
