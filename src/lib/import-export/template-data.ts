/**
 * HU-4.5 · Datos demo de la plantilla `.xlsx` descargable.
 *
 * Se mantiene como helper puro y separado del Route Handler para que
 * los tests puedan ejercitarlo sin tocar Next.js. La consigna del
 * mapping doc es servir 3 hojas con ejemplos representativos:
 *
 *  - Tareas: 1 sin parent (raíz), 2 con parent_mnemonic.
 *  - Dependencias: 1 FS lag=0, 1 SS lag=2.
 *  - Recursos: 2 emails distintos.
 *
 * Las fechas son determinísticas para que el archivo descargado sea
 * reproducible (útil para ETag/diff). Usamos UTC explícito.
 */

import {
  buildExcelWorkbook,
  type ExportDepsRow,
  type ExportResourcesRow,
  type ExportTasksRow,
} from './excel-writer'

const DEMO_TASKS: ExportTasksRow[] = [
  {
    mnemonic: 'DEMO-1',
    title: 'Análisis de requerimientos',
    parent_mnemonic: null,
    start_date: new Date('2026-05-04T00:00:00.000Z'),
    end_date: new Date('2026-05-08T00:00:00.000Z'),
    duration_days: 5,
    is_milestone: false,
    progress: 100,
    priority: 'HIGH',
    assignee_email: 'lider@avante.com',
    tags: 'planificacion,kickoff',
    description: 'Levantar requisitos funcionales y no funcionales con stakeholders.',
  },
  {
    mnemonic: 'DEMO-2',
    title: 'Diseño de arquitectura',
    parent_mnemonic: 'DEMO-1',
    start_date: new Date('2026-05-11T00:00:00.000Z'),
    end_date: new Date('2026-05-15T00:00:00.000Z'),
    duration_days: 5,
    is_milestone: false,
    progress: 50,
    priority: 'CRITICAL',
    assignee_email: 'arquitecto@avante.com',
    tags: 'arquitectura,diseno',
    description: 'Definir blueprint técnico y patrones de integración.',
  },
  {
    mnemonic: 'DEMO-3',
    title: 'Hito: Aprobación de diseño',
    parent_mnemonic: 'DEMO-1',
    start_date: new Date('2026-05-15T00:00:00.000Z'),
    end_date: new Date('2026-05-15T00:00:00.000Z'),
    duration_days: 1,
    is_milestone: true,
    progress: 0,
    priority: 'MEDIUM',
    assignee_email: null,
    tags: 'hito',
    description: null,
  },
]

const DEMO_DEPS: ExportDepsRow[] = [
  {
    predecessor_mnemonic: 'DEMO-1',
    successor_mnemonic: 'DEMO-2',
    type: 'FS',
    lag_days: 0,
  },
  {
    predecessor_mnemonic: 'DEMO-2',
    successor_mnemonic: 'DEMO-3',
    type: 'SS',
    lag_days: 2,
  },
]

const DEMO_RESOURCES: ExportResourcesRow[] = [
  { email: 'lider@avante.com', name: 'Líder de Proyecto', role: 'AGENTE' },
  { email: 'arquitecto@avante.com', name: 'Arquitecto', role: 'AGENTE' },
]

/**
 * Construye la plantilla canónica. Devuelve un `Uint8Array` listo para
 * servir como `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`.
 */
export async function buildTemplateWorkbook(): Promise<Uint8Array> {
  return buildExcelWorkbook({
    tasks: DEMO_TASKS,
    deps: DEMO_DEPS,
    resources: DEMO_RESOURCES,
    projectName: 'FollowupGantt · Plantilla',
  })
}

/** Nombre canónico del archivo descargado. Versionado para forzar refresco. */
export const TEMPLATE_FILENAME = 'followupgantt-plantilla-v1.xlsx'
