import { describe, it, expect, vi } from 'vitest'

const {
  registerImRuntimeTarget,
  clearImRuntimeSessionTarget,
  clearImRuntimeTargetSession,
} = await import('../../src/main/managers/im-binding-runtime.js')

describe('im-binding-runtime', () => {
  it('registers a session target and target session index', () => {
    const sessionTargets = new Map()
    const targetSessionMap = new Map()

    registerImRuntimeTarget({
      sessionTargets,
      targetSessionMap,
      sessionId: 'session-a',
      targetId: 'target-a',
      target: { userId: 'target-a', displayName: 'Target A' },
      getTargetId: target => target?.userId,
    })

    expect(sessionTargets.get('session-a')).toEqual({ userId: 'target-a', displayName: 'Target A' })
    expect(targetSessionMap.get('target-a')).toBe('session-a')
  })

  it('removes the previous target index when a session is rebound to another target', () => {
    const sessionTargets = new Map([
      ['session-a', { userId: 'target-a', displayName: 'Target A' }],
    ])
    const targetSessionMap = new Map([
      ['target-a', 'session-a'],
    ])
    const onReplaceSessionTarget = vi.fn()

    const result = registerImRuntimeTarget({
      sessionTargets,
      targetSessionMap,
      sessionId: 'session-a',
      targetId: 'target-b',
      target: { userId: 'target-b', displayName: 'Target B' },
      getTargetId: target => target?.userId,
      onReplaceSessionTarget,
    })

    expect(result.previousTarget).toEqual({ userId: 'target-a', displayName: 'Target A' })
    expect(targetSessionMap.has('target-a')).toBe(false)
    expect(targetSessionMap.get('target-b')).toBe('session-a')
    expect(onReplaceSessionTarget).toHaveBeenCalledWith({
      sessionId: 'session-a',
      previousTarget: { userId: 'target-a', displayName: 'Target A' },
      previousTargetId: 'target-a',
      nextTargetId: 'target-b',
    })
  })

  it('removes the previous session when a target is rebound to another session', () => {
    const sessionTargets = new Map([
      ['session-a', { openId: 'target-a', displayName: 'Target A' }],
    ])
    const targetSessionMap = new Map([
      ['target-a', 'session-a'],
    ])
    const onReplaceTargetSession = vi.fn()

    const result = registerImRuntimeTarget({
      sessionTargets,
      targetSessionMap,
      sessionId: 'session-b',
      targetId: 'target-a',
      target: { openId: 'target-a', displayName: 'Target A' },
      getTargetId: target => target?.openId,
      onReplaceTargetSession,
    })

    expect(result.previousSessionId).toBe('session-a')
    expect(sessionTargets.has('session-a')).toBe(false)
    expect(sessionTargets.get('session-b')).toEqual({ openId: 'target-a', displayName: 'Target A' })
    expect(targetSessionMap.get('target-a')).toBe('session-b')
    expect(onReplaceTargetSession).toHaveBeenCalledWith({
      previousSessionId: 'session-a',
      previousSessionTarget: { openId: 'target-a', displayName: 'Target A' },
      previousSessionTargetId: 'target-a',
      targetId: 'target-a',
      nextSessionId: 'session-b',
    })
  })

  it('clears a session target without deleting a newer target owner', () => {
    const sessionTargets = new Map([
      ['session-a', { targetId: 'target-a' }],
    ])
    const targetSessionMap = new Map([
      ['target-a', 'session-b'],
    ])

    const target = clearImRuntimeSessionTarget({
      sessionTargets,
      targetSessionMap,
      sessionId: 'session-a',
    })

    expect(target).toEqual({ targetId: 'target-a' })
    expect(sessionTargets.has('session-a')).toBe(false)
    expect(targetSessionMap.get('target-a')).toBe('session-b')
  })

  it('clears a target session index and its owning session target', () => {
    const sessionTargets = new Map([
      ['session-a', { targetId: 'target-a' }],
    ])
    const targetSessionMap = new Map([
      ['target-a', 'session-a'],
    ])

    const sessionId = clearImRuntimeTargetSession({
      sessionTargets,
      targetSessionMap,
      targetId: 'target-a',
    })

    expect(sessionId).toBe('session-a')
    expect(sessionTargets.has('session-a')).toBe(false)
    expect(targetSessionMap.has('target-a')).toBe(false)
  })
})
