import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ConflictDialog } from '@/components/realtime-locks/ConflictDialog'

describe('ConflictDialog', () => {
  it('no renderiza el contenido cuando open=false', () => {
    render(
      <ConflictDialog
        open={false}
        onOpenChange={() => {}}
        localValue="A"
        remoteValue="B"
        onResolve={() => {}}
      />,
    )
    expect(screen.queryByTestId('conflict-dialog')).not.toBeInTheDocument()
  })

  it('renderiza título "Cambios remotos detectados" y descripción con autor', () => {
    render(
      <ConflictDialog
        open
        onOpenChange={() => {}}
        localValue="A"
        remoteValue="B"
        remoteAuthor="Pedro"
        onResolve={() => {}}
      />,
    )
    expect(
      screen.getByText(/Cambios remotos detectados/i),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Pedro guardó cambios mientras editabas/i),
    ).toBeInTheDocument()
  })

  it('muestra fallback genérico si remoteAuthor es null', () => {
    render(
      <ConflictDialog
        open
        onOpenChange={() => {}}
        localValue="A"
        remoteValue="B"
        remoteAuthor={null}
        onResolve={() => {}}
      />,
    )
    expect(
      screen.getByText(/Otro usuario guardó cambios mientras editabas/i),
    ).toBeInTheDocument()
  })

  it('muestra fieldLabel cuando se provee', () => {
    render(
      <ConflictDialog
        open
        onOpenChange={() => {}}
        fieldLabel="Título"
        localValue="A"
        remoteValue="B"
        onResolve={() => {}}
      />,
    )
    expect(screen.getByText(/campo: Título/)).toBeInTheDocument()
  })

  it('renderiza side-by-side: tu versión y versión remota', () => {
    render(
      <ConflictDialog
        open
        onOpenChange={() => {}}
        localValue="texto local"
        remoteValue="texto remoto"
        onResolve={() => {}}
      />,
    )
    const local = screen.getByTestId('conflict-dialog-local')
    const remote = screen.getByTestId('conflict-dialog-remote')
    expect(local).toHaveTextContent('texto local')
    expect(remote).toHaveTextContent('texto remoto')
  })

  it('muestra placeholder "(vacío)" cuando localValue es string vacío', () => {
    render(
      <ConflictDialog
        open
        onOpenChange={() => {}}
        localValue=""
        remoteValue="B"
        onResolve={() => {}}
      />,
    )
    const local = screen.getByTestId('conflict-dialog-local')
    expect(local).toHaveTextContent('(vacío)')
  })

  it('botón "Mantener mi versión" invoca onResolve("overwrite") y cierra', async () => {
    const onResolve = vi.fn()
    const onOpenChange = vi.fn()
    render(
      <ConflictDialog
        open
        onOpenChange={onOpenChange}
        localValue="A"
        remoteValue="B"
        onResolve={onResolve}
      />,
    )
    await userEvent.click(screen.getByTestId('conflict-dialog-overwrite'))
    expect(onResolve).toHaveBeenCalledWith('overwrite')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('botón "Aceptar versión remota" invoca onResolve("accept_remote")', async () => {
    const onResolve = vi.fn()
    render(
      <ConflictDialog
        open
        onOpenChange={() => {}}
        localValue="A"
        remoteValue="B"
        onResolve={onResolve}
      />,
    )
    await userEvent.click(
      screen.getByTestId('conflict-dialog-accept-remote'),
    )
    expect(onResolve).toHaveBeenCalledWith('accept_remote')
  })

  it('botón "Cancelar" invoca onResolve("cancel")', async () => {
    const onResolve = vi.fn()
    render(
      <ConflictDialog
        open
        onOpenChange={() => {}}
        localValue="A"
        remoteValue="B"
        onResolve={onResolve}
      />,
    )
    await userEvent.click(screen.getByTestId('conflict-dialog-cancel'))
    expect(onResolve).toHaveBeenCalledWith('cancel')
  })

  it('cerrar el dialog (Esc/click X) llama onResolve("cancel")', async () => {
    const onResolve = vi.fn()
    const onOpenChange = vi.fn()
    render(
      <ConflictDialog
        open
        onOpenChange={onOpenChange}
        localValue="A"
        remoteValue="B"
        onResolve={onResolve}
      />,
    )
    // Botón X de cierre del Radix Dialog (aria-label="Cerrar")
    const closeBtn = screen.getByRole('button', { name: /cerrar/i })
    await userEvent.click(closeBtn)
    expect(onResolve).toHaveBeenCalledWith('cancel')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('Dialog.Title accesible por nombre', () => {
    render(
      <ConflictDialog
        open
        onOpenChange={() => {}}
        localValue="A"
        remoteValue="B"
        onResolve={() => {}}
      />,
    )
    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeInTheDocument()
    // El title está dentro del dialog
    expect(dialog).toHaveTextContent(/Cambios remotos detectados/i)
  })
})
