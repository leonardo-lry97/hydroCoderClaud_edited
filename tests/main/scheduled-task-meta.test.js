import { describe, expect, it } from 'vitest'

import {
  resolveScheduledTaskEffectiveModelId,
  resolveScheduledTaskModelId
} from '../../src/renderer/utils/scheduled-task-meta.js'

describe('scheduled-task-meta model selection', () => {
  const context = {
    apiProfiles: [
      { id: 'profile-a', serviceProvider: 'provider-a', selectedModelId: 'model-default-a' },
      { id: 'profile-b', serviceProvider: 'provider-b', selectedModelId: 'model-default-b' }
    ],
    serviceProviderDefinitions: [
      { id: 'provider-a', defaultModels: ['model-default-a', 'model-alt-a'] },
      { id: 'provider-b', defaultModels: ['model-default-b', 'model-alt-b'] }
    ],
    defaultProfileId: 'profile-a'
  }

  it('falls back to the current profile default when the preferred model is empty', () => {
    expect(resolveScheduledTaskModelId(context, '')).toBe('model-default-a')
    expect(resolveScheduledTaskModelId({ ...context, apiProfileId: 'profile-b' }, null)).toBe('model-default-b')
  })

  it('keeps explicit model ids only when they are available under the current profile', () => {
    expect(resolveScheduledTaskModelId(context, 'model-alt-a')).toBe('model-alt-a')
    expect(resolveScheduledTaskModelId({ ...context, apiProfileId: 'profile-b' }, 'model-alt-a')).toBe('model-default-b')
  })

  it('resolves the effective display model from the profile when the task follows default', () => {
    expect(resolveScheduledTaskEffectiveModelId(context, '')).toBe('model-default-a')
    expect(resolveScheduledTaskEffectiveModelId({ ...context, apiProfileId: 'profile-b' }, '')).toBe('model-default-b')
  })
})
