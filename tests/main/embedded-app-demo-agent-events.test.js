import { describe, expect, it } from 'vitest'

const eventFormat = await import('../../src/renderer/pages/embedded-app-demo/agent-event-format.js')

describe('embedded app demo agent event formatting', () => {
  it('extracts assistant text from real agent:message content blocks', () => {
    const text = eventFormat.extractAssistantMessageText({
      channel: 'agent:message',
      payload: {
        sessionId: 'session-1',
        message: {
          type: 'assistant',
          content: [
            { type: 'text', text: 'hello' },
            { type: 'tool_use', name: 'Read' },
            { type: 'text', text: 'world' }
          ]
        }
      }
    })

    expect(text).toBe('hello\n[tool_use] Read\nworld')
  })

  it('extracts stream text from nested stream event payloads', () => {
    const text = eventFormat.extractStreamText({
      channel: 'agent:stream',
      payload: {
        sessionId: 'session-1',
        event: {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'partial' }
        }
      }
    })

    expect(text).toBe('partial')
  })

  it('reads interaction requests from the main-process payload shape', () => {
    const interaction = eventFormat.getInteractionRequest({
      channel: 'agent:interactionRequest',
      payload: {
        sessionId: 'session-1',
        interaction: {
          interactionId: 'interaction-1',
          kind: 'ask_user_question',
          questions: [{ question: '是否继续？' }]
        }
      }
    })

    expect(interaction).toMatchObject({
      interactionId: 'interaction-1',
      kind: 'ask_user_question'
    })
    expect(eventFormat.buildAutoInteractionResponse(interaction)).toEqual({
      questions: [{ question: '是否继续？' }],
      answers: [{ question: '是否继续？', answer: '示例页自动确认：继续执行' }],
      behavior: 'allow'
    })
  })
})
