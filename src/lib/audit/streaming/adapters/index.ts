/**
 * R3-E · Audit Streaming · Selector de adapter por kind.
 */

import type { AuditStreamKind } from '@prisma/client'
import type { Adapter } from '../types'
import { splunkAdapter } from './splunk'
import { datadogAdapter } from './datadog'
import { genericAdapter } from './generic'

export function getAdapter(kind: AuditStreamKind): Adapter {
  switch (kind) {
    case 'SPLUNK':
      return splunkAdapter
    case 'DATADOG':
      return datadogAdapter
    case 'GENERIC_WEBHOOK':
      return genericAdapter
    default: {
      const exhaustive: never = kind
      throw new Error(`[ADAPTER_UNKNOWN] kind no soportado: ${String(exhaustive)}`)
    }
  }
}

export { splunkAdapter, datadogAdapter, genericAdapter }
