import { describe, expect, it } from 'vitest'

import {
  createScheduledTaskFormDefaults
} from '../../src/renderer/utils/scheduled-task-meta.js'

describe('scheduled-task-meta defaults', () => {
  it('creates defaults without task-level runtime fields', () => {
    expect(createScheduledTaskFormDefaults('C:/workspace')).toMatchObject({
      cwd: 'C:/workspace',
      sessionBindingMode: 'new',
      scheduleType: 'interval',
      intervalMinutes: 60
    })
  })
})
