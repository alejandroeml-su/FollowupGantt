import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * Wave P8 · Equipo P8-4 — Tests del componente `AttachmentUploader`.
 *
 * Cubre:
 *   - Render dropzone + input file.
 *   - Selección via input → upload + onUploaded callback.
 *   - Multi-file: una row por archivo.
 *   - Pre-validación tamaño client-side (no llama action).
 *   - Error de la action → row con estado error.
 *   - Drop sobre la zona dispara la subida.
 */

const uploadAttachmentActionMock = vi.fn()

vi.mock('@/lib/storage/upload-attachment', async () => {
  // Re-export real `MAX_FILE_BYTES` para que el componente conozca el tope
  // pero sustituye la action por un mock controlable.
  const actual = await vi.importActual<typeof import('@/lib/storage/upload-attachment')>(
    '@/lib/storage/upload-attachment',
  )
  return {
    ...actual,
    uploadAttachmentAction: (...args: unknown[]) =>
      uploadAttachmentActionMock(...args),
  }
})

import { AttachmentUploader } from '@/components/attachments/AttachmentUploader'

// ─────────────────────────── Fixtures ───────────────────────────

function makeFile(content: string, name: string, type: string): File {
  return new File([content], name, { type })
}

beforeEach(() => {
  uploadAttachmentActionMock.mockReset().mockImplementation(async () => ({
    id: 'att-new',
    taskId: 't1',
    filename: 'foo.png',
    storagePath: 'u1/uuid-foo.png',
    mimeType: 'image/png',
    sizeBytes: 5,
    uploadedById: 'u1',
    uploadedAt: '2026-05-05T10:00:00.000Z',
    createdAt: '2026-05-05T10:00:00.000Z',
  }))
})

// ─────────────────────────── Tests ───────────────────────────

describe('AttachmentUploader', () => {
  it('renderiza dropzone con instrucciones y tope de tamaño', () => {
    render(<AttachmentUploader taskId="t1" onUploaded={vi.fn()} />)
    expect(screen.getByTestId('attachment-uploader')).toBeInTheDocument()
    expect(screen.getByTestId('attachment-dropzone')).toBeInTheDocument()
    // Muestra el cap de 25 MB.
    expect(screen.getByText(/25\.0 MB/)).toBeInTheDocument()
  })

  it('sube un archivo seleccionado via input y llama onUploaded', async () => {
    const onUploaded = vi.fn()
    const user = userEvent.setup()
    render(<AttachmentUploader taskId="t1" onUploaded={onUploaded} />)

    const input = screen.getByTestId('attachment-file-input') as HTMLInputElement
    const file = makeFile('hello', 'foo.png', 'image/png')
    await user.upload(input, file)

    await waitFor(() => {
      expect(uploadAttachmentActionMock).toHaveBeenCalledOnce()
    })
    await waitFor(() => {
      expect(onUploaded).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'att-new', filename: 'foo.png' }),
      )
    })
  })

  it('soporta selección multi-archivo: una row por archivo', async () => {
    const onUploaded = vi.fn()
    const user = userEvent.setup()
    render(<AttachmentUploader taskId="t1" onUploaded={onUploaded} />)

    const input = screen.getByTestId('attachment-file-input') as HTMLInputElement
    await user.upload(input, [
      makeFile('a', 'a.png', 'image/png'),
      makeFile('b', 'b.png', 'image/png'),
      makeFile('c', 'c.pdf', 'application/pdf'),
    ])

    await waitFor(() => {
      expect(uploadAttachmentActionMock).toHaveBeenCalledTimes(3)
    })
    await waitFor(() => {
      expect(onUploaded).toHaveBeenCalledTimes(3)
    })
  })

  it('rechaza pre-emptivamente archivos > 25MB sin llamar la action', async () => {
    const user = userEvent.setup()
    render(<AttachmentUploader taskId="t1" onUploaded={vi.fn()} />)

    const huge = new File(['x'], 'big.png', { type: 'image/png' })
    Object.defineProperty(huge, 'size', { value: 25 * 1024 * 1024 + 1 })
    const input = screen.getByTestId('attachment-file-input') as HTMLInputElement
    await user.upload(input, huge)

    // No debe haber llamado la action.
    expect(uploadAttachmentActionMock).not.toHaveBeenCalled()
    // Debe mostrar la fila con estado de error.
    const row = await screen.findByTestId('attachment-progress-row')
    expect(row.getAttribute('data-status')).toBe('error')
    expect(row.textContent).toMatch(/demasiado grande/i)
  })

  it('marca la fila con error si la action lanza', async () => {
    uploadAttachmentActionMock.mockRejectedValueOnce(
      new Error('[UPLOAD_FAILED] boom'),
    )
    const onUploaded = vi.fn()
    const user = userEvent.setup()
    render(<AttachmentUploader taskId="t1" onUploaded={onUploaded} />)

    const input = screen.getByTestId('attachment-file-input') as HTMLInputElement
    await user.upload(input, makeFile('x', 'x.png', 'image/png'))

    const row = await screen.findByTestId('attachment-progress-row')
    await waitFor(() => {
      expect(row.getAttribute('data-status')).toBe('error')
    })
    expect(onUploaded).not.toHaveBeenCalled()
    expect(row.textContent).toMatch(/UPLOAD_FAILED/)
  })

  it('drop sobre la zona dispara la subida', async () => {
    const onUploaded = vi.fn()
    render(<AttachmentUploader taskId="t1" onUploaded={onUploaded} />)
    const dropzone = screen.getByTestId('attachment-dropzone')

    const file = makeFile('hello', 'dropped.png', 'image/png')

    fireEvent.drop(dropzone, {
      dataTransfer: {
        files: [file],
        items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }],
        types: ['Files'],
      },
    })

    await waitFor(() => {
      expect(uploadAttachmentActionMock).toHaveBeenCalledOnce()
    })
    await waitFor(() => {
      expect(onUploaded).toHaveBeenCalledOnce()
    })
  })

  it('aplica estado data-dragover=true durante un dragover', () => {
    render(<AttachmentUploader taskId="t1" onUploaded={vi.fn()} />)
    const dropzone = screen.getByTestId('attachment-dropzone')
    expect(dropzone.getAttribute('data-dragover')).toBe('false')

    fireEvent.dragOver(dropzone)
    expect(dropzone.getAttribute('data-dragover')).toBe('true')

    fireEvent.dragLeave(dropzone)
    expect(dropzone.getAttribute('data-dragover')).toBe('false')
  })

  it('permite quitar manualmente una fila de progreso con error', async () => {
    uploadAttachmentActionMock.mockRejectedValueOnce(new Error('[UPLOAD_FAILED] x'))
    const user = userEvent.setup()
    render(<AttachmentUploader taskId="t1" onUploaded={vi.fn()} />)

    const input = screen.getByTestId('attachment-file-input') as HTMLInputElement
    await user.upload(input, makeFile('x', 'x.png', 'image/png'))

    const row = await screen.findByTestId('attachment-progress-row')
    const remove = row.querySelector('button[aria-label^="Quitar"]')!
    await user.click(remove as Element)
    await waitFor(() => {
      expect(screen.queryByTestId('attachment-progress-row')).toBeNull()
    })
  })
})
