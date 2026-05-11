'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Pencil, Trash2, Copy, FlaskConical } from 'lucide-react'
import {
  createSsoProvider,
  updateSsoProvider,
  deleteSsoProvider,
  testSsoMetadata,
} from '@/lib/actions/sso'

/**
 * R3.0 · Fase 2 · SSO/SAML — Cliente admin para CRUD de proveedores.
 *
 * Lista tabular + dialog combinado (create/edit) con sección "Importar
 * desde metadata XML" que invoca `testSsoMetadata` y rellena los campos.
 *
 * Display de URLs SP (entityId + ACS + login) con botón copy — el admin
 * pega esos valores en la consola del IdP.
 */

type AttributeMap = {
  email?: string
  name?: string
  groups?: string
  roleMap?: Record<string, string>
}

export type SsoProviderRow = {
  id: string
  workspaceId: string
  workspaceName: string
  workspaceSlug: string
  name: string
  kind: string
  entityId: string
  ssoUrl: string
  x509Cert: string
  attributeMap: Record<string, unknown>
  enabled: boolean
  linkCount: number
  createdAt: string
  spEntityId: string
  acsUrl: string
  loginUrl: string
}

type WorkspaceOption = { id: string; name: string; slug: string }

function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message.replace(/^\[[A-Z_]+\]\s*/, '')
  }
  return 'Error desconocido'
}

function isAttributeMap(v: unknown): v is AttributeMap {
  return typeof v === 'object' && v !== null
}

export function SsoProviderClient({
  initialProviders,
  workspaces,
}: {
  initialProviders: SsoProviderRow[]
  workspaces: WorkspaceOption[]
}) {
  const router = useRouter()
  const [openDialog, setOpenDialog] = useState<
    | { mode: 'create' }
    | { mode: 'edit'; row: SsoProviderRow }
    | null
  >(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const handleDelete = (row: SsoProviderRow) => {
    if (
      !confirm(
        `Eliminar el proveedor "${row.name}" del workspace ${row.workspaceName}? Esta acción borra también los vínculos federados (${row.linkCount}).`,
      )
    ) {
      return
    }
    setError(null)
    startTransition(async () => {
      try {
        await deleteSsoProvider({ id: row.id })
        router.refresh()
      } catch (err) {
        setError(extractErrorMessage(err))
      }
    })
  }

  const handleToggle = (row: SsoProviderRow) => {
    setError(null)
    startTransition(async () => {
      try {
        await updateSsoProvider({ id: row.id, enabled: !row.enabled })
        router.refresh()
      } catch (err) {
        setError(extractErrorMessage(err))
      }
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => {
            setError(null)
            setOpenDialog({ mode: 'create' })
          }}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500"
        >
          <Plus className="h-4 w-4" />
          Nuevo proveedor
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
        >
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-border bg-card/40">
        <table className="w-full text-sm">
          <thead className="bg-subtle/40">
            <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-3 font-semibold">Proveedor</th>
              <th className="px-4 py-3 font-semibold">Workspace</th>
              <th className="px-4 py-3 font-semibold">EntityID IdP</th>
              <th className="px-4 py-3 font-semibold">Vínculos</th>
              <th className="px-4 py-3 font-semibold">Estado</th>
              <th className="px-4 py-3 text-right font-semibold">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {initialProviders.map((p) => (
              <tr
                key={p.id}
                className={`border-t border-border ${p.enabled ? '' : 'opacity-60'}`}
              >
                <td className="px-4 py-3">
                  <div className="font-medium text-foreground">{p.name}</div>
                  <div className="text-xs text-muted-foreground">{p.kind}</div>
                </td>
                <td className="px-4 py-3">
                  <div className="text-sm">{p.workspaceName}</div>
                  <div className="font-mono text-xs text-muted-foreground">
                    /{p.workspaceSlug}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="max-w-xs truncate font-mono text-xs text-foreground/80">
                    {p.entityId}
                  </div>
                </td>
                <td className="px-4 py-3 text-sm">{p.linkCount}</td>
                <td className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => handleToggle(p)}
                    disabled={isPending}
                    className={
                      p.enabled
                        ? 'inline-flex items-center rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-300 hover:bg-emerald-500/25'
                        : 'inline-flex items-center rounded-full bg-zinc-500/15 px-2 py-0.5 text-xs text-zinc-300 hover:bg-zinc-500/25'
                    }
                    aria-label={p.enabled ? 'Deshabilitar' : 'Habilitar'}
                  >
                    {p.enabled ? 'Activo' : 'Inactivo'}
                  </button>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="inline-flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setError(null)
                        setOpenDialog({ mode: 'edit', row: p })
                      }}
                      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-subtle hover:text-foreground"
                      aria-label={`Editar ${p.name}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(p)}
                      disabled={isPending}
                      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-red-500/20 hover:text-red-300 disabled:opacity-50"
                      aria-label={`Eliminar ${p.name}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {initialProviders.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-12 text-center text-sm text-muted-foreground"
                >
                  Sin proveedores SSO configurados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {openDialog && (
        <SsoProviderDialog
          state={openDialog}
          workspaces={workspaces}
          onClose={() => setOpenDialog(null)}
          onError={setError}
        />
      )}
    </div>
  )
}

function CopyableField({
  label,
  value,
}: {
  label: string
  value: string
}) {
  const [copied, setCopied] = useState(false)
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // noop
    }
  }
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium text-foreground/80">{label}</div>
      <div className="flex items-center gap-2 rounded-lg border border-border bg-background/40 px-3 py-2">
        <code className="flex-1 truncate text-xs text-foreground/90">{value}</code>
        <button
          type="button"
          onClick={handleCopy}
          className="rounded-md p-1 text-muted-foreground hover:bg-subtle hover:text-foreground"
          aria-label={`Copiar ${label}`}
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
        {copied && (
          <span className="text-[10px] text-emerald-400">Copiado</span>
        )}
      </div>
    </div>
  )
}

function SsoProviderDialog({
  state,
  workspaces,
  onClose,
  onError,
}: {
  state:
    | { mode: 'create' }
    | { mode: 'edit'; row: SsoProviderRow }
  workspaces: WorkspaceOption[]
  onClose: () => void
  onError: (msg: string | null) => void
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [isTesting, startTest] = useTransition()
  const [localError, setLocalError] = useState<string | null>(null)
  const [metadataXml, setMetadataXml] = useState('')

  const initial = state.mode === 'edit' ? state.row : null
  const initialMap = isAttributeMap(initial?.attributeMap)
    ? (initial?.attributeMap as AttributeMap)
    : { email: '' }

  const [workspaceId, setWorkspaceId] = useState(
    initial?.workspaceId ?? (workspaces[0]?.id ?? ''),
  )
  const [name, setName] = useState(initial?.name ?? '')
  const [entityId, setEntityId] = useState(initial?.entityId ?? '')
  const [ssoUrl, setSsoUrl] = useState(initial?.ssoUrl ?? '')
  const [x509Cert, setX509Cert] = useState(initial?.x509Cert ?? '')
  const [emailAttr, setEmailAttr] = useState(
    initialMap.email ?? 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
  )
  const [nameAttr, setNameAttr] = useState(initialMap.name ?? '')
  const [groupsAttr, setGroupsAttr] = useState(initialMap.groups ?? '')
  const [enabled, setEnabled] = useState(initial?.enabled ?? true)

  const handleImportMetadata = () => {
    setLocalError(null)
    if (!metadataXml.trim()) {
      setLocalError('Pega el XML del IdP primero')
      return
    }
    if (!workspaceId) {
      setLocalError('Selecciona un workspace antes de probar la metadata')
      return
    }
    startTest(async () => {
      try {
        const parsed = await testSsoMetadata({ workspaceId, xml: metadataXml })
        setEntityId(parsed.entityId)
        setSsoUrl(parsed.ssoUrl)
        setX509Cert(parsed.x509Cert)
        setLocalError(null)
      } catch (err) {
        setLocalError(extractErrorMessage(err))
      }
    })
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onError(null)
    setLocalError(null)
    const attributeMap = {
      email: emailAttr.trim(),
      name: nameAttr.trim() || undefined,
      groups: groupsAttr.trim() || undefined,
    }
    startTransition(async () => {
      try {
        if (state.mode === 'create') {
          await createSsoProvider({
            workspaceId,
            name: name.trim(),
            entityId: entityId.trim(),
            ssoUrl: ssoUrl.trim(),
            x509Cert: x509Cert.trim(),
            attributeMap,
            enabled,
          })
        } else {
          await updateSsoProvider({
            id: state.row.id,
            name: name.trim(),
            entityId: entityId.trim(),
            ssoUrl: ssoUrl.trim(),
            x509Cert: x509Cert.trim(),
            attributeMap,
            enabled,
          })
        }
        onClose()
        router.refresh()
      } catch (err) {
        const msg = extractErrorMessage(err)
        setLocalError(msg)
        onError(msg)
      }
    })
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="sso-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-border bg-card p-6 shadow-2xl"
      >
        <h2
          id="sso-dialog-title"
          className="mb-4 text-lg font-semibold text-foreground"
        >
          {state.mode === 'create'
            ? 'Configurar proveedor SAML'
            : `Editar "${state.row.name}"`}
        </h2>

        {/* SP URLs (solo edit) */}
        {state.mode === 'edit' && (
          <fieldset className="mb-6 space-y-3 rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-4">
            <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-indigo-300">
              Pega estos valores en el IdP
            </legend>
            <CopyableField label="SP EntityID" value={state.row.spEntityId} />
            <CopyableField label="Assertion Consumer Service (ACS)" value={state.row.acsUrl} />
            <CopyableField label="Login URL (start)" value={state.row.loginUrl} />
          </fieldset>
        )}

        {/* Importar metadata XML */}
        <fieldset className="mb-6 space-y-3 rounded-xl border border-border bg-subtle/20 p-4">
          <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Importar desde metadata IdP (opcional)
          </legend>
          <textarea
            value={metadataXml}
            onChange={(e) => setMetadataXml(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-foreground focus:border-indigo-500 focus:outline-none"
            placeholder="<EntityDescriptor xmlns=…>…</EntityDescriptor>"
          />
          <button
            type="button"
            onClick={handleImportMetadata}
            disabled={isTesting}
            className="inline-flex items-center gap-2 rounded-md bg-indigo-500/20 px-3 py-1.5 text-xs font-medium text-indigo-200 hover:bg-indigo-500/30 disabled:opacity-50"
          >
            <FlaskConical className="h-3.5 w-3.5" />
            {isTesting ? 'Parseando…' : 'Probar y rellenar campos'}
          </button>
        </fieldset>

        {localError && (
          <div
            role="alert"
            className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200"
          >
            {localError}
          </div>
        )}

        <div className="space-y-4">
          {state.mode === 'create' && (
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-foreground/90">
                Workspace
              </span>
              <select
                required
                value={workspaceId}
                onChange={(e) => setWorkspaceId(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-indigo-500 focus:outline-none"
              >
                <option value="">— selecciona —</option>
                {workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} (/{w.slug})
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-foreground/90">
              Nombre interno
            </span>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-indigo-500 focus:outline-none"
              placeholder="Ej: Azure AD Avante"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-foreground/90">
              EntityID del IdP
            </span>
            <input
              required
              value={entityId}
              onChange={(e) => setEntityId(e.target.value)}
              maxLength={500}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-foreground focus:border-indigo-500 focus:outline-none"
              placeholder="https://sts.windows.net/<tenant>/"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-foreground/90">
              SSO URL del IdP
            </span>
            <input
              required
              type="url"
              value={ssoUrl}
              onChange={(e) => setSsoUrl(e.target.value)}
              maxLength={1000}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-foreground focus:border-indigo-500 focus:outline-none"
              placeholder="https://login.microsoftonline.com/<tenant>/saml2"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-foreground/90">
              Certificado X.509 público (PEM o base64)
            </span>
            <textarea
              required
              value={x509Cert}
              onChange={(e) => setX509Cert(e.target.value)}
              rows={4}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-[11px] text-foreground focus:border-indigo-500 focus:outline-none"
              placeholder="MIIDdzCCAl+gAwIBAgIE…"
            />
          </label>

          <fieldset className="space-y-3 rounded-xl border border-border p-3">
            <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Mapeo de atributos SAML
            </legend>
            <label className="block">
              <span className="mb-1 block text-xs text-foreground/90">
                Atributo email *
              </span>
              <input
                required
                value={emailAttr}
                onChange={(e) => setEmailAttr(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-foreground focus:border-indigo-500 focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-foreground/90">
                Atributo nombre (opcional)
              </span>
              <input
                value={nameAttr}
                onChange={(e) => setNameAttr(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-foreground focus:border-indigo-500 focus:outline-none"
                placeholder="http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-foreground/90">
                Atributo grupos (opcional)
              </span>
              <input
                value={groupsAttr}
                onChange={(e) => setGroupsAttr(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-foreground focus:border-indigo-500 focus:outline-none"
                placeholder="http://schemas.microsoft.com/ws/2008/06/identity/claims/groups"
              />
            </label>
          </fieldset>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-border bg-background"
            />
            <span className="text-sm text-foreground/90">Habilitado</span>
          </label>
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-subtle hover:text-foreground"
            disabled={isPending}
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={isPending}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
          >
            {isPending
              ? 'Guardando…'
              : state.mode === 'create'
                ? 'Crear'
                : 'Guardar'}
          </button>
        </div>
      </form>
    </div>
  )
}
