import { describe, it, expect } from 'vitest'

/**
 * Wave P17-B · Tests del catálogo de eventos webhook v2.
 */

import { validateV2Events, KNOWN_V2_EVENTS } from '@/lib/webhooks-out/events'

describe('validateV2Events', () => {
  it('filtra desconocidos y deduplica', () => {
    expect(
      validateV2Events([
        'task.created',
        'task.created',
        'unknown.event',
        'risk.high_severity',
        42 as unknown as string,
      ]),
    ).toEqual(['task.created', 'risk.high_severity'])
  })

  it('input no-array devuelve []', () => {
    expect(validateV2Events('task.created')).toEqual([])
    expect(validateV2Events(null)).toEqual([])
  })

  it('los 3 eventos canónicos son válidos', () => {
    expect(validateV2Events([...KNOWN_V2_EVENTS])).toEqual([
      'task.created',
      'risk.high_severity',
      'project.status_changed',
    ])
  })
})
