/**
 * Wave P7 · Equipo P7-2 · WBS Generator — Fallback heurístico.
 *
 * Cuando el LLM real falla (timeout, rate limit, output inválido), caemos
 * a un generador determinista por templates. Tres templates predefinidos:
 *   1. software-project    → "implementar / desarrollar / app / sistema / api"
 *   2. marketing-campaign  → "campaña / marketing / lanzamiento / branding"
 *   3. infrastructure-deploy → "deploy / despliegue / migración / cloud / kubernetes"
 *
 * Si ningún template matchea, usamos `software-project` como default
 * (cubre la mayoría de proyectos de la unidad de transformación digital).
 *
 * Cada template retorna un WBS de 3 phases × 5-8 tasks, dependencias FS
 * intra-fase, sin ciclos, sin profundidad (children siempre vacíos). El
 * resultado es VÁLIDO contra `wbsSchema` por construcción.
 */

import type { WBSGenerated, WBSTask } from './wbs-schema'

export type TemplateId =
  | 'software-project'
  | 'marketing-campaign'
  | 'infrastructure-deploy'

interface TemplateMatch {
  id: TemplateId
  /** Score de match basado en cuántos keywords aparecen en el brief. */
  score: number
}

const TEMPLATE_KEYWORDS: Record<TemplateId, string[]> = {
  'software-project': [
    'software',
    'app',
    'aplicacion',
    'aplicación',
    'sistema',
    'plataforma',
    'crm',
    'erp',
    'web',
    'mobile',
    'api',
    'backend',
    'frontend',
    'desarrollar',
    'desarrollo',
    'implementar',
    'implementación',
    'feature',
    'producto',
  ],
  'marketing-campaign': [
    'campaña',
    'campana',
    'marketing',
    'lanzamiento',
    'branding',
    'redes sociales',
    'social media',
    'publicidad',
    'awareness',
    'leads',
    'contenido',
    'evento',
  ],
  'infrastructure-deploy': [
    'infraestructura',
    'infra',
    'deploy',
    'despliegue',
    'migración',
    'migracion',
    'cloud',
    'aws',
    'azure',
    'gcp',
    'kubernetes',
    'k8s',
    'docker',
    'terraform',
    'red',
    'datacenter',
    'servidor',
  ],
}

/**
 * Detecta el template más probable a partir del brief. Si ninguno
 * matchea con score>0, retorna `'software-project'` por default.
 */
export function pickTemplate(brief: string): TemplateMatch {
  const lower = brief.toLowerCase()
  let best: TemplateMatch = { id: 'software-project', score: 0 }
  for (const [id, words] of Object.entries(TEMPLATE_KEYWORDS) as Array<
    [TemplateId, string[]]
  >) {
    const score = words.reduce(
      (acc, w) => (lower.includes(w) ? acc + 1 : acc),
      0,
    )
    if (score > best.score) best = { id, score }
  }
  return best
}

// ─────────────────────────── Templates ─────────────────────────────────

function softwareProjectWBS(projectName: string, teamSize: number): WBSGenerated {
  const phases = [
    {
      name: 'Discovery y diseño',
      order: 0,
      tasks: [
        t('Levantamiento de requerimientos', 'PMI_TASK', 5, 'HIGH', ['producto'], [], ['análisis']),
        t('Investigación de usuarios', 'PMI_TASK', 4, 'MEDIUM', ['ux'], ['Levantamiento de requerimientos'], ['ux research']),
        t('Diseño de arquitectura técnica', 'PMI_TASK', 4, 'HIGH', ['arquitectura'], ['Levantamiento de requerimientos'], ['arquitecto']),
        t('Mockups y prototipos', 'PMI_TASK', 5, 'MEDIUM', ['ux'], ['Investigación de usuarios'], ['ui/ux']),
        t('Plan de pruebas y QA', 'PMI_TASK', 3, 'MEDIUM', ['qa'], ['Diseño de arquitectura técnica'], ['qa']),
      ],
    },
    {
      name: 'Implementación',
      order: 1,
      tasks: [
        t('Setup del entorno de desarrollo', 'PMI_TASK', 2, 'HIGH', ['devops'], ['Diseño de arquitectura técnica'], ['devops']),
        t('Desarrollo backend / APIs', 'AGILE_STORY', 15, 'CRITICAL', ['backend'], ['Setup del entorno de desarrollo'], ['backend', 'node.js']),
        t('Desarrollo frontend', 'AGILE_STORY', 15, 'CRITICAL', ['frontend'], ['Setup del entorno de desarrollo'], ['frontend', 'react']),
        t('Integraciones con terceros', 'AGILE_STORY', 7, 'HIGH', ['integraciones'], ['Desarrollo backend / APIs'], ['integraciones']),
        t('Pruebas unitarias y de integración', 'AGILE_STORY', 8, 'HIGH', ['qa'], ['Desarrollo backend / APIs', 'Desarrollo frontend'], ['qa', 'testing']),
      ],
    },
    {
      name: 'Lanzamiento y estabilización',
      order: 2,
      tasks: [
        t('UAT con usuarios clave', 'PMI_TASK', 5, 'HIGH', ['uat'], ['Pruebas unitarias y de integración'], ['producto']),
        t('Documentación y manuales', 'PMI_TASK', 4, 'MEDIUM', ['docs'], ['UAT con usuarios clave'], ['technical writing']),
        t('Capacitación al equipo', 'PMI_TASK', 3, 'MEDIUM', ['training'], ['Documentación y manuales'], ['training']),
        t('Despliegue a producción', 'PMI_TASK', 2, 'CRITICAL', ['release'], ['UAT con usuarios clave'], ['devops']),
        t('Soporte hipercare', 'ITIL_TICKET', 7, 'HIGH', ['support'], ['Despliegue a producción'], ['soporte']),
        t('Cierre y retrospectiva', 'PMI_TASK', 2, 'MEDIUM', ['cierre'], ['Soporte hipercare'], ['liderazgo']),
      ],
    },
  ]
  return {
    projectName,
    description: 'Proyecto de software con metodología Agile + PMI balanceada.',
    estimatedDurationDays: estimateDuration(phases, teamSize),
    phases,
    risks: [
      {
        title: 'Scope creep en implementación',
        description: 'Cambio de alcance durante implementación que impacta cronograma y costo',
        probability: 4,
        impact: 4,
        mitigation: 'Definir gates de change-control formal (CCB) y backlog priorizado por valor de negocio',
        triggerDelayDays: 14,
      },
      {
        title: 'Disponibilidad limitada de stakeholders en UAT',
        description: 'Stakeholders clave con agenda saturada que retrasa la validación',
        probability: 3,
        impact: 4,
        mitigation: 'Calendarizar UAT con 2 semanas de anticipación + sesiones cortas de 90 min',
        triggerDelayDays: 7,
      },
      {
        title: 'Bloqueo por integración de terceros',
        description: 'Dependencia de APIs/servicios externos cuya disponibilidad no controlamos',
        probability: 3,
        impact: 5,
        mitigation: 'Spike de validación temprana + mocks durante dev + plan B si proveedor falla',
        triggerDelayDays: 10,
      },
      {
        title: 'Rotación del equipo técnico',
        description: 'Pérdida de un dev senior durante el sprint crítico de implementación',
        probability: 2,
        impact: 4,
        mitigation: 'Pair programming + documentación inline + cobertura cruzada en cada feature',
        triggerDelayDays: 15,
      },
      {
        title: 'Rendimiento bajo carga real',
        description: 'Sistema funciona en QA pero degrada en producción con tráfico real',
        probability: 3,
        impact: 4,
        mitigation: 'Pruebas de carga con datos representativos + monitoring + plan de scaling',
        triggerDelayDays: 7,
      },
    ],
  }
}

function marketingCampaignWBS(projectName: string, teamSize: number): WBSGenerated {
  const phases = [
    {
      name: 'Estrategia y planificación',
      order: 0,
      tasks: [
        t('Definir objetivos SMART', 'PMI_TASK', 2, 'HIGH', ['estrategia'], [], ['marketing']),
        t('Investigación de mercado y audiencia', 'PMI_TASK', 5, 'HIGH', ['research'], ['Definir objetivos SMART'], ['research']),
        t('Plan de medios y presupuesto', 'PMI_TASK', 3, 'HIGH', ['plan'], ['Investigación de mercado y audiencia'], ['media planning']),
        t('Briefing creativo', 'PMI_TASK', 2, 'MEDIUM', ['creativo'], ['Plan de medios y presupuesto'], ['creativo']),
        t('KPIs y métricas de éxito', 'PMI_TASK', 1, 'MEDIUM', ['analytics'], ['Definir objetivos SMART'], ['analytics']),
      ],
    },
    {
      name: 'Producción de contenido',
      order: 1,
      tasks: [
        t('Diseño gráfico y copys', 'AGILE_STORY', 10, 'HIGH', ['contenido'], ['Briefing creativo'], ['diseño', 'copywriting']),
        t('Producción audiovisual', 'AGILE_STORY', 12, 'HIGH', ['video'], ['Briefing creativo'], ['producción', 'video']),
        t('Adaptación a canales digitales', 'AGILE_STORY', 5, 'MEDIUM', ['contenido'], ['Diseño gráfico y copys'], ['social media']),
        t('Aprobaciones legales y de marca', 'PMI_TASK', 3, 'HIGH', ['legal'], ['Diseño gráfico y copys'], ['legal', 'branding']),
      ],
    },
    {
      name: 'Lanzamiento y medición',
      order: 2,
      tasks: [
        t('Configuración de pauta digital', 'PMI_TASK', 3, 'HIGH', ['ads'], ['Aprobaciones legales y de marca'], ['ads', 'meta', 'google']),
        t('Lanzamiento oficial', 'PMI_TASK', 1, 'CRITICAL', ['launch'], ['Configuración de pauta digital'], ['marketing']),
        t('Monitoreo y optimización en vivo', 'AGILE_STORY', 14, 'HIGH', ['analytics'], ['Lanzamiento oficial'], ['analytics']),
        t('Reporte de resultados y aprendizajes', 'PMI_TASK', 3, 'MEDIUM', ['reporte'], ['Monitoreo y optimización en vivo'], ['analytics']),
        t('Cierre con stakeholders', 'PMI_TASK', 1, 'LOW', ['cierre'], ['Reporte de resultados y aprendizajes'], ['liderazgo']),
      ],
    },
  ]
  return {
    projectName,
    description: 'Campaña de marketing con producción de contenido y medición continua.',
    estimatedDurationDays: estimateDuration(phases, teamSize),
    phases,
    risks: [
      {
        title: 'Retraso en aprobaciones de marca o legales',
        description: 'Piezas creativas atascadas en revisión legal/branding',
        probability: 4,
        impact: 3,
        mitigation: 'Subir piezas a revisión por lotes con SLA de 3 días hábiles + matriz de aprobadores',
        triggerDelayDays: 5,
      },
      {
        title: 'Variación del tipo de cambio o costos de pauta',
        description: 'Inflación en CPM/CPC o devaluación que reduce alcance del presupuesto',
        probability: 3,
        impact: 3,
        mitigation: 'Reservar 15% de buffer presupuestario y monitorear semanalmente',
        triggerDelayDays: 0,
      },
      {
        title: 'Bajo engagement post-lanzamiento',
        description: 'Métricas de engagement por debajo del baseline esperado las primeras 72h',
        probability: 3,
        impact: 4,
        mitigation: 'Activar pruebas A/B en creatividades y reasignar pauta a top performers',
        triggerDelayDays: 3,
      },
      {
        title: 'Crisis de reputación durante la campaña',
        description: 'Comentarios negativos virales o asociación no deseada con eventos externos',
        probability: 2,
        impact: 5,
        mitigation: 'Plan de comunicación de crisis preaprobado + monitoreo de menciones 24/7',
        triggerDelayDays: 7,
      },
    ],
  }
}

function infrastructureDeployWBS(projectName: string, teamSize: number): WBSGenerated {
  const phases = [
    {
      name: 'Assessment y diseño',
      order: 0,
      tasks: [
        t('Inventario y dependencias del sistema actual', 'PMI_TASK', 4, 'HIGH', ['assessment'], [], ['arquitectura']),
        t('Diseño de arquitectura objetivo (cloud)', 'PMI_TASK', 5, 'HIGH', ['arquitectura'], ['Inventario y dependencias del sistema actual'], ['arquitectura', 'cloud']),
        t('Plan de migración y rollback', 'PMI_TASK', 3, 'HIGH', ['plan'], ['Diseño de arquitectura objetivo (cloud)'], ['arquitectura']),
        t('Definir KPIs SRE (SLO/SLI)', 'PMI_TASK', 2, 'MEDIUM', ['sre'], ['Diseño de arquitectura objetivo (cloud)'], ['sre']),
      ],
    },
    {
      name: 'Implementación y despliegue',
      order: 1,
      tasks: [
        t('Provisión de IaC (Terraform)', 'PMI_TASK', 6, 'CRITICAL', ['iac'], ['Plan de migración y rollback'], ['terraform', 'devops']),
        t('Pipelines CI/CD', 'PMI_TASK', 4, 'HIGH', ['ci'], ['Provisión de IaC (Terraform)'], ['ci/cd']),
        t('Migración de datos', 'PMI_TASK', 6, 'CRITICAL', ['datos'], ['Provisión de IaC (Terraform)'], ['dba']),
        t('Pruebas de carga y performance', 'PMI_TASK', 4, 'HIGH', ['perf'], ['Migración de datos', 'Pipelines CI/CD'], ['sre', 'qa']),
        t('Configuración de observabilidad', 'PMI_TASK', 3, 'HIGH', ['obs'], ['Pipelines CI/CD'], ['sre', 'observabilidad']),
      ],
    },
    {
      name: 'Cutover y operación',
      order: 2,
      tasks: [
        t('Ventana de cutover y switchover', 'PMI_TASK', 1, 'CRITICAL', ['release'], ['Pruebas de carga y performance'], ['sre']),
        t('Validación post-cutover', 'PMI_TASK', 2, 'HIGH', ['validacion'], ['Ventana de cutover y switchover'], ['qa', 'sre']),
        t('Soporte hipercare', 'ITIL_TICKET', 10, 'HIGH', ['support'], ['Validación post-cutover'], ['soporte', 'sre']),
        t('Decomisionar infraestructura legacy', 'PMI_TASK', 3, 'MEDIUM', ['cierre'], ['Soporte hipercare'], ['arquitectura']),
        t('Cierre y postmortem', 'PMI_TASK', 1, 'MEDIUM', ['cierre'], ['Decomisionar infraestructura legacy'], ['liderazgo']),
      ],
    },
  ]
  return {
    projectName,
    description: 'Despliegue / migración de infraestructura con operación SRE.',
    estimatedDurationDays: estimateDuration(phases, teamSize),
    phases,
    risks: [
      {
        title: 'Pérdida de datos durante migración',
        description: 'Corrupción o pérdida parcial al migrar datos críticos al nuevo entorno',
        probability: 2,
        impact: 5,
        mitigation: 'Snapshot full + verificación checksum pre/post migración + plan de rollback validado',
        triggerDelayDays: 14,
      },
      {
        title: 'Ventana de cutover excede tiempo planeado',
        description: 'Cutover toma más horas que la ventana acordada con el negocio',
        probability: 4,
        impact: 4,
        mitigation: 'Ensayo full de cutover en staging con cronómetro + go/no-go en T-1h',
        triggerDelayDays: 7,
      },
      {
        title: 'Costos cloud sobre presupuesto',
        description: 'Consumo de instancias/egress excede la estimación inicial',
        probability: 3,
        impact: 3,
        mitigation: 'Activar budgets/alerts día 1 + tagging por proyecto + revisión semanal de FinOps',
        triggerDelayDays: 0,
      },
      {
        title: 'Incompatibilidad entre versiones de servicios',
        description: 'Versión cloud de un servicio no soporta features usadas en legacy',
        probability: 3,
        impact: 4,
        mitigation: 'POC de cada servicio en assessment + matriz de compatibilidad + workarounds',
        triggerDelayDays: 10,
      },
      {
        title: 'Degradación de performance post-migración',
        description: 'Latencias mayores en cloud vs on-prem que afectan SLAs comprometidos',
        probability: 3,
        impact: 4,
        mitigation: 'Pruebas de carga con datos representativos + tuning + circuit breakers',
        triggerDelayDays: 5,
      },
    ],
  }
}

// ─────────────────────────── Helpers internos ──────────────────────────

function t(
  title: string,
  type: WBSTask['type'],
  estimatedDays: number,
  priority: WBSTask['priority'],
  tags: string[],
  dependsOn: string[],
  suggestedSkills: string[],
): WBSTask {
  return {
    title,
    type,
    estimatedDays,
    priority,
    tags,
    dependsOn,
    suggestedSkills,
  }
}

/**
 * Estima la duración total como camino crítico simplificado: por cada fase,
 * tomamos el max de duraciones; sumamos entre fases. `teamSize` reduce
 * el total con un factor de paralelismo limitado por Brooks (no escala
 * lineal): factor = 1 / sqrt(teamSize).
 */
function estimateDuration(
  phases: Array<{ tasks: WBSTask[] }>,
  teamSize: number,
): number {
  const sumOfMax = phases.reduce((acc, p) => {
    const max = p.tasks.reduce((m, task) => Math.max(m, task.estimatedDays), 0)
    return acc + max
  }, 0)
  const factor = teamSize > 1 ? 1 / Math.sqrt(teamSize) : 1
  // No bajamos del max simple en una sola fase.
  const minFloor = phases.reduce(
    (acc, p) => acc + Math.max(...p.tasks.map((task) => task.estimatedDays)),
    0,
  )
  return Math.max(1, Math.round(Math.max(sumOfMax * factor, minFloor * 0.4)))
}

// ─────────────────────────── Entry point ───────────────────────────────

export interface HeuristicOptions {
  projectName?: string
  teamSize?: number
  /** Forzar un template (si no, se infiere por keywords). */
  forceTemplate?: TemplateId
}

/**
 * Genera un WBS heurístico determinístico para un brief. Nunca lanza
 * (siempre retorna un WBS válido contra `wbsSchema`).
 */
export function generateWBSFromBriefHeuristic(
  brief: string,
  options: HeuristicOptions = {},
): { wbs: WBSGenerated; templateId: TemplateId } {
  const matched = options.forceTemplate
    ? { id: options.forceTemplate, score: 0 }
    : pickTemplate(brief)
  const projectName = options.projectName?.trim() || deriveProjectName(brief)
  const teamSize = options.teamSize ?? 3

  switch (matched.id) {
    case 'marketing-campaign':
      return { wbs: marketingCampaignWBS(projectName, teamSize), templateId: matched.id }
    case 'infrastructure-deploy':
      return { wbs: infrastructureDeployWBS(projectName, teamSize), templateId: matched.id }
    case 'software-project':
    default:
      return { wbs: softwareProjectWBS(projectName, teamSize), templateId: 'software-project' }
  }
}

/**
 * Deriva un nombre del proyecto a partir del brief: primera oración (≤ 80
 * chars). Si está vacío, usa "Proyecto sin título".
 */
function deriveProjectName(brief: string): string {
  const first = brief.split(/[\.\n]/)[0]?.trim() ?? ''
  if (!first) return 'Proyecto sin título'
  return first.length > 80 ? first.slice(0, 77) + '...' : first
}
