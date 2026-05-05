import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const cardPath = path.resolve(__dirname, '../../src/renderer/pages/main/components/agent/AskUserQuestionCard.vue')

describe('AskUserQuestionCard', () => {
  it('declares isMultiSelectQuestion before the immediate watch uses it', () => {
    const source = fs.readFileSync(cardPath, 'utf-8')
    const helperIndex = source.indexOf('const isMultiSelectQuestion = (question) => {')
    const watchIndex = source.indexOf('watch(questions, (value) => {')

    expect(helperIndex).toBeGreaterThanOrEqual(0)
    expect(watchIndex).toBeGreaterThanOrEqual(0)
    expect(helperIndex).toBeLessThan(watchIndex)
  })
})
