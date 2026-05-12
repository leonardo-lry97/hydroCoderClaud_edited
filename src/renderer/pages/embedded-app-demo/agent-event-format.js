export function extractContentText(content) {
  if (!content) return ''
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map(extractContentText)
      .filter(Boolean)
      .join('\n')
  }
  if (typeof content !== 'object') return ''

  if (typeof content.text === 'string') return content.text
  if (typeof content.delta === 'string') return content.delta
  if (typeof content.textDelta === 'string') return content.textDelta
  if (content.delta && typeof content.delta === 'object') return extractContentText(content.delta)
  if (content.content) return extractContentText(content.content)
  if (content.type === 'tool_use') return `[tool_use] ${content.name || 'tool'}`
  if (content.type === 'tool_result') return '[tool_result]'

  return ''
}

export function extractAssistantMessageText(event) {
  const message = event?.payload?.message || {}
  return extractContentText(message.content || message.text || event?.payload?.content || event?.payload?.text)
}

export function extractStreamText(event) {
  const payload = event?.payload || {}
  return extractContentText(
    payload.delta ||
    payload.textDelta ||
    payload.text ||
    payload.event?.delta ||
    payload.event?.text ||
    payload.event
  )
}

export function getInteractionRequest(event) {
  const payload = event?.payload || {}
  const interaction = payload.interaction || payload
  return interaction?.interactionId && interaction?.kind ? interaction : null
}

export function buildAutoInteractionResponse(interaction) {
  const questions = Array.isArray(interaction?.questions) ? interaction.questions : []
  return {
    questions,
    answers: questions.length > 0
      ? questions.map((question, index) => ({
          question: question.question || `question_${index + 1}`,
          answer: '示例页自动确认：继续执行'
        }))
      : [{ question: 'confirm', answer: '示例页自动确认：继续执行' }],
    behavior: 'allow'
  }
}
