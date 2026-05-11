'use client'

/**
 * Wave P14 · Trigger lazy del ProjectDefinitionDialog.
 *
 * Recibe solo `projectId` + `catalogs`. Al hacer click carga la definición
 * actual del proyecto vía `getProjectDefinition` server action y luego abre
 * el dialog. Útil para incrustar en listas (cada `ProjectCard` en /projects)
 * sin tener que pre-cargar members/teams de TODOS los proyectos en SSR.
 */

import { useState, useTransition } from 'react'
import { Settings } from 'lucide-react'
import { getProjectDefinition } from '@/lib/actions/project-definition'
import {
  ProjectDefinitionDialog,
  type ProjectDefinitionCatalogs,
  type ProjectDefinitionState,
} from './ProjectDefinitionDialog'
import { useTranslation } from '@/lib/i18n/use-translation'

interface Props {
  projectId: string
  projectName: string
  catalogs: ProjectDefinitionCatalogs
  /** Estilo del trigger: "icon" minimal · "button" con texto. */
  variant?: 'icon' | 'button'
  className?: string
}

export function ProjectDefinitionLazyTrigger({
  projectId,
  projectName,
  catalogs,
  variant = 'icon',
  className,
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [initial, setInitial] = useState<ProjectDefinitionState | null>(null)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const handleClick = () => {
    setError(null)
    startTransition(async () => {
      try {
        const def = await getProjectDefinition(projectId)
        if (!def) {
          setError(t('pages.projects.projectNotFound'))
          return
        }
        setInitial({
          id: def.id,
          name: def.name,
          description: def.description,
          status: def.status,
          methodology: def.methodology,
          areaId: def.areaId,
          managerId: def.managerId,
          budget: def.budget !== null ? Number(def.budget) : null,
          budgetCurrency: def.budgetCurrency,
          members: def.assignments.map((a) => a.user),
          teams: def.teamProjects.map((tp) => ({
            id: tp.team.id,
            name: tp.team.name,
            memberCount: tp.team.members.length,
          })),
        })
        setOpen(true)
      } catch (err) {
        setError(err instanceof Error ? err.message : t('pages.projects.genericError'))
      }
    })
  }

  return (
    <>
      {variant === 'icon' ? (
        <button
          type="button"
          onClick={handleClick}
          disabled={pending}
          aria-label={t('pages.projects.editDefinitionOf', { name: projectName })}
          title={t('pages.projects.definitionAndMembers')}
          className={
            className ??
            'p-1 rounded text-muted-foreground hover:bg-indigo-500/20 hover:text-indigo-400 transition-colors disabled:opacity-50'
          }
        >
          <Settings className="h-4 w-4" />
        </button>
      ) : (
        <button
          type="button"
          onClick={handleClick}
          disabled={pending}
          className={
            className ??
            'inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-subtle disabled:opacity-50'
          }
        >
          <Settings className="h-3.5 w-3.5" />
          {pending ? t('pages.projects.loadingDots') : t('pages.projects.definitionAndMembers')}
        </button>
      )}
      {error && (
        <span role="alert" className="text-[10px] text-rose-400 ml-2">
          {error}
        </span>
      )}
      {open && initial && (
        <ProjectDefinitionDialog
          open={open}
          onOpenChange={(o) => {
            setOpen(o)
            if (!o) setInitial(null)
          }}
          initial={initial}
          catalogs={catalogs}
        />
      )}
    </>
  )
}
