'use server'

import { computeCpm, type CpmWarning } from '@/lib/scheduling/cpm'
import { loadCpmInputForProject } from '@/lib/scheduling/prismaAdapter'

/**
 * Versión serializable del CpmTaskResult (Date → ISO string) para que el
 * server action pueda devolver el resultado a un client component.
 */
export interface SerializableCpmResult {
  id: string
  ES: number
  EF: number
  LS: number
  LF: number
  totalFloat: number
  isCritical: boolean
  startDate: string
  endDate: string
}

export interface SerializableCpmOutput {
  results: SerializableCpmResult[]
  criticalPath: string[]
  projectDuration: number
  warnings: CpmWarning[]
}

function actionError(code: string, detail: string): never {
  throw new Error(`[${code}] ${detail}`)
}

export async function getCpmForProject(
  projectId: string,
): Promise<SerializableCpmOutput> {
  if (!projectId) actionError('NOT_FOUND', 'projectId requerido')

  const input = await loadCpmInputForProject(projectId)
  const out = computeCpm(input)

  const results: SerializableCpmResult[] = []
  for (const r of out.results.values()) {
    results.push({
      id: r.id,
      ES: r.ES,
      EF: r.EF,
      LS: r.LS,
      LF: r.LF,
      totalFloat: r.totalFloat,
      isCritical: r.isCritical,
      startDate: r.startDate.toISOString(),
      endDate: r.endDate.toISOString(),
    })
  }

  return {
    results,
    criticalPath: out.criticalPath,
    projectDuration: out.projectDuration,
    warnings: out.warnings,
  }
}
