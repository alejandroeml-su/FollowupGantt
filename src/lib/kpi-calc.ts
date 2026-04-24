import type { TaskStatus, TaskType } from '@prisma/client'

export type KPIFilters = {
  gerenciaId?: string
  areaId?: string
  projectId?: string
  status?: TaskStatus
  type?: TaskType
  assigneeId?: string
}

export type KPIValue = {
  value: number | null
  label: string
  tone: 'success' | 'warning' | 'danger' | 'neutral'
  hint: string
}

export type KPIBundle = {
  pv: number
  ev: number
  ac: number
  sv: KPIValue
  cv: KPIValue
  cpi: KPIValue
  spi: KPIValue
  roi: KPIValue
  successRate: KPIValue
  resourceUtilization: KPIValue
  scopeCreep: KPIValue
  plannedVsActual: {
    planned: number
    actual: number
    ratio: KPIValue
  }
  trend: Array<{ month: string; pv: number; ev: number; ac: number }>
  totals: {
    projects: number
    tasks: number
    completedTasks: number
    activeProjects: number
  }
}

export type KPIFilterOptions = {
  gerencias: Array<{ id: string; name: string }>
  areas: Array<{ id: string; name: string; gerenciaId: string }>
  projects: Array<{ id: string; name: string; areaId: string | null }>
  users: Array<{ id: string; name: string }>
}

export function formatCurrency(n: number | null): string {
  if (n == null || !isFinite(n)) return '—'
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`
  return `${sign}$${abs.toFixed(0)}`
}

export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function lastNMonths(n: number, reference: Date = new Date()): string[] {
  const out: string[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(reference.getFullYear(), reference.getMonth() - i, 1)
    out.push(monthKey(d))
  }
  return out
}

export function classifyIndex(value: number | null, kind: 'spi' | 'cpi'): KPIValue {
  if (value == null || !isFinite(value)) {
    return {
      value: null,
      label: 'Sin datos',
      tone: 'neutral',
      hint: kind === 'spi' ? 'No hay valor planificado registrado' : 'No hay costo real registrado',
    }
  }
  if (value >= 1) {
    return {
      value,
      label: kind === 'spi' ? 'Adelantado' : 'Eficiente',
      tone: 'success',
      hint: kind === 'spi' ? 'Avanza más rápido de lo previsto' : 'Gasta menos de lo previsto',
    }
  }
  if (value >= 0.9) {
    return {
      value,
      label: 'En margen',
      tone: 'warning',
      hint: kind === 'spi' ? 'Ligera desviación de cronograma' : 'Ligera desviación de costo',
    }
  }
  return {
    value,
    label: kind === 'spi' ? 'Retrasado' : 'Sobre costo',
    tone: 'danger',
    hint: kind === 'spi' ? 'Requiere replanificación' : 'Requiere control de costos',
  }
}

export function classifyVariance(
  value: number,
  pv: number,
  kind: 'schedule' | 'cost',
): KPIValue {
  if (value >= 0) {
    return {
      value,
      label: kind === 'schedule' ? 'Adelantado' : 'Bajo presupuesto',
      tone: 'success',
      hint: `${formatCurrency(value)} ${kind === 'schedule' ? 'de avance sobre lo planificado' : 'ahorrados frente al plan'}`,
    }
  }
  const ratio = pv > 0 ? value / pv : Number.NEGATIVE_INFINITY
  if (ratio >= -0.1) {
    return {
      value,
      label: kind === 'schedule' ? 'Ligero retraso' : 'Ligero sobregiro',
      tone: 'warning',
      hint: `${formatCurrency(Math.abs(value))} ${kind === 'schedule' ? 'de retraso' : 'sobre el plan'}`,
    }
  }
  return {
    value,
    label: kind === 'schedule' ? 'Retraso crítico' : 'Sobregiro crítico',
    tone: 'danger',
    hint: `${formatCurrency(Math.abs(value))} ${kind === 'schedule' ? 'de retraso sobre el plan' : 'por encima del presupuesto'}`,
  }
}

export function classifyROI(value: number | null): KPIValue {
  if (value == null || !isFinite(value)) {
    return { value: null, label: 'Sin datos', tone: 'neutral', hint: 'Costo real en 0' }
  }
  if (value >= 15) return { value, label: 'Alto retorno', tone: 'success', hint: 'Rentabilidad saludable' }
  if (value >= 0) return { value, label: 'Positivo', tone: 'success', hint: 'Inversión recuperada' }
  if (value >= -10) return { value, label: 'Marginal', tone: 'warning', hint: 'Margen ajustado' }
  return { value, label: 'Negativo', tone: 'danger', hint: 'Rentabilidad en riesgo' }
}

export function classifySuccessRate(value: number | null): KPIValue {
  if (value == null) return { value: null, label: 'Sin datos', tone: 'neutral', hint: 'Sin proyectos cerrados' }
  if (value >= 80) return { value, label: 'Excelente', tone: 'success', hint: 'Cumplimiento saludable del portafolio' }
  if (value >= 60) return { value, label: 'Aceptable', tone: 'warning', hint: 'Oportunidad de mejora' }
  return { value, label: 'Bajo', tone: 'danger', hint: 'Revisar causas raíz de incumplimientos' }
}

export function classifyUtilization(value: number | null): KPIValue {
  if (value == null) return { value: null, label: 'Sin datos', tone: 'neutral', hint: 'Sin horas registradas' }
  if (value > 90) return { value, label: 'Sobrecargado', tone: 'danger', hint: 'Riesgo de burnout del equipo' }
  if (value >= 70) return { value, label: 'Óptimo', tone: 'success', hint: 'Rango saludable 70-90%' }
  if (value >= 50) return { value, label: 'Subutilizado', tone: 'warning', hint: 'Capacidad ociosa detectada' }
  return { value, label: 'Crítico', tone: 'danger', hint: 'Equipo con baja asignación' }
}

export function classifyScopeCreep(value: number | null): KPIValue {
  if (value == null) return { value: null, label: 'Sin datos', tone: 'neutral', hint: 'Sin tareas comparables' }
  if (value <= 5) return { value, label: 'Controlado', tone: 'success', hint: 'Alcance estable' }
  if (value <= 15) return { value, label: 'Atención', tone: 'warning', hint: 'Cambios moderados no planificados' }
  return { value, label: 'Alto riesgo', tone: 'danger', hint: 'Scope creep supera el umbral tolerado' }
}

export function classifyPlannedVsActual(ratio: number | null): KPIValue {
  if (ratio == null) return { value: null, label: 'Sin datos', tone: 'neutral', hint: 'Sin tareas planificadas' }
  if (ratio >= 95) return { value: ratio, label: 'En plan', tone: 'success', hint: 'Ritmo de entrega conforme' }
  if (ratio >= 75) return { value: ratio, label: 'En riesgo', tone: 'warning', hint: 'Ligero rezago de entregas' }
  return { value: ratio, label: 'Desviado', tone: 'danger', hint: 'Rezago significativo de entregas' }
}

export type EVMTaskInput = {
  plannedValue: number | null
  actualCost: number | null
  earnedValue: number | null
  progress: number
}

export function computeEVMTotals(tasks: EVMTaskInput[]): { pv: number; ev: number; ac: number } {
  let pv = 0
  let ev = 0
  let ac = 0
  for (const t of tasks) {
    const taskPV = t.plannedValue ?? 0
    const taskAC = t.actualCost ?? 0
    const taskEV = t.earnedValue ?? taskPV * ((t.progress ?? 0) / 100)
    pv += taskPV
    ac += taskAC
    ev += taskEV
  }
  return { pv, ev, ac }
}
