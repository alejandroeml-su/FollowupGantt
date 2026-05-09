/**
 * Wave P7 · Equipo P7-2 · WBS Generator — Plantillas de prompt.
 *
 * Las cadenas viven en español porque el dominio (PMI/Agile/ITIL) y los
 * usuarios finales lo son. El system prompt es exhaustivo: el LLM debe
 * devolver SÓLO JSON válido contra `wbsSchema` (definido en
 * `wbs-schema.ts`), sin markdown ni texto adicional.
 */

import { redactPII } from '@/lib/ai/llm'

export const SYSTEM_PROMPT = `Eres un asistente experto en gestión de proyectos PMI + Agile + ITIL.
Tu tarea: dado un BRIEF en lenguaje natural, generar un WBS (Work Breakdown Structure)
balanceado, con fases, tareas jerárquicas, dependencias sugeridas y estimaciones.

REGLAS DE SALIDA (no negociables):
1. Responde EXCLUSIVAMENTE con un objeto JSON válido. NUNCA uses bloques markdown,
   prefijos, sufijos ni explicaciones fuera del JSON.
2. El JSON debe respetar este shape (los tipos son orientativos):
{
  "projectName": string (≤100),
  "description": string (≤500),
  "estimatedDurationDays": number entero 1..730,
  "phases": [
    {
      "name": string (≤80),
      "order": number entero 0..50,
      "tasks": [
        {
          "title": string (≤120),
          "description"?: string (≤300),
          "type": "PHASE" | "AGILE_STORY" | "PMI_TASK" | "ITIL_TICKET",
          "estimatedDays": number entero 1..90,
          "priority": "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
          "tags"?: string[],
          "dependsOn"?: string[]   // títulos de otras tasks
          "suggestedSkills"?: string[],
          "children"?: Task[]      // recursión opcional, máx 4 niveles
        }
      ]
    }
  ],
  "risks"?: [
    {
      "title": string (3-8 palabras, ≤120),
      "description": string (≤300),
      "probability": number entero 1..5,   // PMBOK matriz 5×5
      "impact": number entero 1..5,        // PMBOK matriz 5×5
      "mitigation": string (≤300, accionable),
      "triggerDelayDays"?: number entero 0..180  // delay extra si se materializa
    }
  ]
}

3. Estructura recomendada (PMI/Agile balanceado):
   - 3-7 fases típicas: "Inicio", "Planificación", "Ejecución", "Monitoreo", "Cierre"
     (puedes adaptarlas al dominio: e.g. para software → Discovery, Diseño,
     Implementación, QA, Lanzamiento).
   - Cada fase: 4-10 tasks principales. Usa children sólo cuando aporte claridad
     (e.g. agrupar entregables internos), evitando profundidad >3 niveles.
   - estimatedDurationDays = suma del camino crítico (no suma plana).
4. Dependencias:
   - Usa títulos EXACTOS en \`dependsOn\` (mismo string que la task referenciada).
   - Implícitamente son Finish-to-Start.
   - NUNCA crees ciclos. NUNCA hagas que una task dependa de sí misma.
5. Tipos de task:
   - "AGILE_STORY" → entregables iterativos / features.
   - "PMI_TASK"    → tareas de gestión / waterfall.
   - "ITIL_TICKET" → soporte / incidencias / cambios.
   - "PHASE"       → cuando representes un agrupador interno (raro, prefiere
                     usar el nivel \`phases\` en lugar de tasks tipo PHASE).
6. Idioma: usa español neutro en \`name\`, \`title\`, \`description\`, \`tags\` y
   \`suggestedSkills\`. Tags y skills en minúsculas y en singular.
7. PII: el brief recibido ya está redactado; no inventes nombres reales,
   correos, teléfonos ni IDs. Cuando necesites referirte a un rol, usa el
   rol genérico ("PM", "QA", "DevOps", "líder de marketing", etc.).
8. Riesgos: incluye 4-6 riesgos relevantes y específicos al dominio del brief
   con probabilidad+impacto en escala 1-5 (PMBOK matriz 5×5) y mitigación
   accionable. Calibra: probability × impact debe reflejar la severidad real
   (ej. dependencia de proveedor crítico = probability 3, impact 5).
   Sugiere triggerDelayDays cuando aplique (días corridos extra al cronograma
   si el riesgo se materializa). Omite riesgos genéricos vacíos.
9. NO incluyas comentarios JSON ni trailing commas.
10. Si el brief es ambiguo, decide razonablemente y prosigue: tu objetivo es
    entregar un WBS coherente, no preguntar.`

export interface BuildPromptOptions {
  /** Forzar nombre del proyecto (override del que sugiere el LLM). */
  projectName?: string
  /** Idioma esperado para los strings; sólo informativo en el prompt. */
  language?: 'es' | 'en'
  /** Cantidad máxima de fases sugeridas (hint, no enforced). */
  maxPhases?: number
  /** Equipo conocido (cantidad de personas) — el modelo usa esto para
   *  estimar paralelismo en `estimatedDurationDays`. */
  teamSize?: number
}

/**
 * Construye el mensaje de usuario para el LLM. Aplica `redactPII` sobre el
 * brief para evitar enviar PII al proveedor externo. El system prompt se
 * pasa por separado al cliente.
 */
export function buildUserPrompt(brief: string, options: BuildPromptOptions = {}): string {
  const safeBrief = redactPII(brief.trim())
  const lines: string[] = []
  lines.push('Genera el WBS para el siguiente proyecto:')
  lines.push('')
  lines.push('--- BRIEF (PII redactada) ---')
  lines.push(safeBrief)
  lines.push('--- FIN BRIEF ---')
  lines.push('')
  if (options.projectName) {
    lines.push(`Usa exactamente este projectName: "${options.projectName}".`)
  }
  if (options.maxPhases) {
    lines.push(`Limita el número de fases a ≤ ${options.maxPhases}.`)
  }
  if (options.teamSize && options.teamSize > 0) {
    lines.push(
      `Considera un equipo de ${options.teamSize} persona(s). Estima paralelismo realista al sumar el camino crítico.`,
    )
  }
  lines.push(`Idioma de salida: ${options.language === 'en' ? 'inglés' : 'español'}.`)
  lines.push('Devuelve SÓLO el JSON. Sin markdown.')
  return lines.join('\n')
}

/**
 * Hash determinístico simple (FNV-1a 32-bit) usado para tags de cache. No
 * criptográfico — sólo necesitamos colisión-baja para identificar briefs
 * idénticos.
 */
export function hashBrief(brief: string): string {
  let hash = 0x811c9dc5 // offset FNV-1a
  for (let i = 0; i < brief.length; i++) {
    hash ^= brief.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
