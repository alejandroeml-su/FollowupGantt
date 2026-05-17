import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { hasAdminRole } from '@/lib/auth/permissions'
import { CmdbImportClient } from '@/components/cmdb/CmdbImportClient'

/**
 * Wave R5-Extended · CMDB avanzado · `/cmdb/import`.
 *
 * Server component que gate ADMIN+ y renderiza el Client form. La
 * validación de rol se duplica en el server action `bulkImportCIs`
 * (defense in depth) — esta page sólo evita que la UI sea visible a
 * quien no la puede usar.
 *
 * No es navegación pública: el link al import sale desde la tabla
 * CMDB (ya existe en `CmdbTableClient` un botón "Importar" condicional
 * — si no, el operador ADMIN va directo por URL).
 */
export const dynamic = 'force-dynamic'

export default async function CmdbImportPage() {
  const user = await getCurrentUser()
  if (!user) {
    redirect('/login?from=/cmdb/import')
  }
  if (!hasAdminRole(user.roles)) {
    // Sin rol ADMIN — devolvemos al listado plano del CMDB. Mantenemos
    // descubrimiento del módulo CMDB pero ocultamos la herramienta de
    // import (misma estrategia que `/cmdb/[ciId]/impact`).
    redirect('/cmdb')
  }
  return <CmdbImportClient />
}
