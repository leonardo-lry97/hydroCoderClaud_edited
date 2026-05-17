import { describe, expect, it, vi } from 'vitest'

const { AgentSessionBroker } = await import('../../src/main/agent-platform/agent-session-broker.js')

describe('AgentSessionBroker embedded session recovery', () => {
  it('backfills embedded appId into persisted embedded sessions when current client provides it', () => {
    const updateAgentConversation = vi.fn()
    const agentSessionManager = {
      sessions: new Map(),
      get: vi.fn(() => null),
      list: vi.fn(() => ([{
        id: 'embedded-1',
        ownerClientId: 'embed:hydrology-workbench',
        clientType: 'embedded',
        clientMeta: null
      }])),
      sessionDatabase: {
        updateAgentConversation
      }
    }

    const broker = new AgentSessionBroker(agentSessionManager)
    const client = {
      clientId: 'embed:hydrology-workbench',
      clientType: 'embedded',
      clientMeta: {
        appId: 'hydrology-workbench',
        component: 'EmbeddedAgentPanel'
      }
    }

    const sessions = broker.list(client)

    expect(sessions).toHaveLength(1)
    expect(sessions[0].clientMeta).toMatchObject({
      appId: 'hydrology-workbench',
      component: 'EmbeddedAgentPanel'
    })
    expect(updateAgentConversation).toHaveBeenCalledWith('embedded-1', {
      clientMeta: {
        appId: 'hydrology-workbench',
        component: 'EmbeddedAgentPanel'
      }
    })
  })
})
