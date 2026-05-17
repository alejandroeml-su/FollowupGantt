import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

/**
 * Wave R5 · US-9.3 — Tests del cliente de la tabla CMDB.
 *
 * Cobertura del componente:
 *   1. Renderiza filtros con los valores iniciales aplicados.
 *   2. Cambiar el filtro de tipo dispara router.push con el `searchParam`
 *      correcto y resetea page.
 *   3. Toggle "Incluir retirados" agrega `retired=1` al URL.
 *
 * Mock global de next/navigation provee router en tests/setup.ts; aquí lo
 * sobrescribimos para capturar las llamadas push.
 */

const pushMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => '/cmdb',
  useSearchParams: () => new URLSearchParams('q=&type=&status='),
}))

import { CmdbTableClient } from '@/components/cmdb/CmdbTableClient'

beforeEach(() => {
  pushMock.mockReset()
})

const emptyResult = {
  total: 0,
  page: 1,
  pageSize: 25,
  items: [],
}

describe('CmdbTableClient · filtros', () => {
  it('renderiza los selects con los valores iniciales y placeholder', () => {
    render(
      <CmdbTableClient
        initialResult={emptyResult}
        initialFilters={{
          type: 'SERVER',
          status: 'ACTIVE',
          criticality: 'HIGH',
        }}
      />,
    )
    const typeSelect = screen.getByTestId('cmdb-filter-type') as HTMLSelectElement
    expect(typeSelect.value).toBe('SERVER')
    const statusSelect = screen.getByTestId('cmdb-filter-status') as HTMLSelectElement
    expect(statusSelect.value).toBe('ACTIVE')
    const critSelect = screen.getByTestId('cmdb-filter-criticality') as HTMLSelectElement
    expect(critSelect.value).toBe('HIGH')

    // Tabla vacía debe mostrar copy fallback.
    expect(
      screen.getByText(/No hay CIs que coincidan con los filtros/i),
    ).toBeInTheDocument()
  })

  it('cambiar filtro de tipo dispara router.push con type=APPLICATION y sin page', () => {
    render(
      <CmdbTableClient
        initialResult={{ ...emptyResult, page: 3 }}
        initialFilters={{ page: 3 }}
      />,
    )

    const typeSelect = screen.getByTestId('cmdb-filter-type') as HTMLSelectElement
    fireEvent.change(typeSelect, { target: { value: 'APPLICATION' } })

    expect(pushMock).toHaveBeenCalledTimes(1)
    const url = pushMock.mock.calls[0]?.[0] as string
    expect(url).toContain('/cmdb?')
    const params = new URLSearchParams(url.split('?')[1])
    expect(params.get('type')).toBe('APPLICATION')
    // Filtro nuevo → reseteamos page.
    expect(params.get('page')).toBeNull()
  })

  it('toggle "Incluir retirados" agrega retired=1 al URL', () => {
    render(
      <CmdbTableClient
        initialResult={emptyResult}
        initialFilters={{ includeRetired: false }}
      />,
    )

    const checkbox = screen.getByTestId('cmdb-filter-retired') as HTMLInputElement
    expect(checkbox.checked).toBe(false)
    fireEvent.click(checkbox)

    expect(pushMock).toHaveBeenCalledTimes(1)
    const url = pushMock.mock.calls[0]?.[0] as string
    const params = new URLSearchParams(url.split('?')[1])
    expect(params.get('retired')).toBe('1')
  })
})
