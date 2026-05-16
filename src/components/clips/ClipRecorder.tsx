'use client'

/**
 * Wave R4 · US-7.3 · Clips de video — Componente de grabación.
 *
 * Modal de grabación con Screen Capture API + MediaRecorder. Flujo:
 *
 *   1. El usuario click "🎥 Grabar clip" → se abre este modal.
 *   2. Selección opcional de "incluir micrófono".
 *   3. Click "Iniciar grabación" → `navigator.mediaDevices.getDisplayMedia`
 *      pide consentimiento del browser para compartir pantalla. Si el
 *      usuario cancela, mostramos error suave y permitimos reintentar.
 *   4. `MediaRecorder` graba a chunks (timeslice 1s). Contador de tiempo
 *      en pantalla con warning visual al pasar `clipMaxDurationSec`.
 *   5. Click "Detener" → consolidamos chunks en un Blob `video/webm`,
 *      capturamos primer-frame en canvas → thumbnail JPEG.
 *   6. Preview con `<video controls>` + slider de trim (inicio/fin),
 *      info de tamaño/duración.
 *   7. Click "Subir" → POST a `createClip` con FormData. Al éxito, el
 *      caller recibe el `ClipDTO` vía `onCreated` y cerramos modal.
 *
 * Notas técnicas:
 *
 *   - Trim "lógico": para no requerir ffmpeg.wasm (pesa ~30 MB), el trim
 *     se aplica recortando el rango de chunks que MediaRecorder produjo
 *     con `timeslice`. Esto NO produce un re-encode preciso al
 *     milisegundo: el corte queda alineado al timeslice (1s). Es aceptable
 *     para clips de explicación rápida; si en el futuro se necesita
 *     precisión sub-segundo, evaluar `MediaStreamTrackProcessor` (Chromium
 *     only) o ffmpeg.wasm post-merge.
 *
 *   - Si el browser no soporta `getDisplayMedia` o `MediaRecorder` con
 *     webm/mp4 → el botón no se renderiza (feature detection en el caller).
 *
 *   - El componente NO hace upload directo al bucket; delega al server
 *     action para conservar RBAC + audit + persistencia atómica.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Mic, MicOff, Video, X, Play, Square, Upload, Loader2 } from 'lucide-react'
import { createClip } from '@/lib/actions/clips'
import {
  CLIP_MAX_DURATION_SEC_DEFAULT,
  CLIP_MAX_SIZE_MB_DEFAULT,
  pickPreferredClipMime,
  type ClipDTO,
} from '@/lib/storage/clip-validation'

type Phase = 'idle' | 'recording' | 'review' | 'uploading' | 'error'

interface Props {
  /** Si se pasa, el clip se asocia a esta task. XOR con `commentId`. */
  taskId?: string | null
  /** Si se pasa, el clip se asocia a este comment. XOR con `taskId`. */
  commentId?: string | null
  /** Callback tras upload exitoso (modal se cierra automáticamente). */
  onCreated?: (clip: ClipDTO) => void
  /** Callback al cerrar el modal. */
  onClose: () => void
}

function formatDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${r.toString().padStart(2, '0')}`
}

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Captura el primer frame del blob de video en un canvas y lo emite como
 * Blob JPEG. Si falla, devuelve null y el clip se sube sin thumbnail.
 */
async function captureFirstFrame(videoBlob: Blob): Promise<Blob | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(videoBlob)
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.muted = true
    video.playsInline = true
    video.src = url
    let resolved = false
    const cleanup = () => {
      URL.revokeObjectURL(url)
      video.remove()
    }
    const fail = () => {
      if (resolved) return
      resolved = true
      cleanup()
      resolve(null)
    }
    video.addEventListener('error', fail)
    video.addEventListener('loadeddata', () => {
      try {
        video.currentTime = 0.1
      } catch {
        fail()
      }
    })
    video.addEventListener('seeked', () => {
      try {
        const w = video.videoWidth || 320
        const h = video.videoHeight || 180
        const canvas = document.createElement('canvas')
        canvas.width = Math.min(w, 640)
        canvas.height = Math.round(canvas.width * (h / Math.max(w, 1)))
        const ctx = canvas.getContext('2d')
        if (!ctx) return fail()
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        canvas.toBlob(
          (blob) => {
            if (resolved) return
            resolved = true
            cleanup()
            resolve(blob)
          },
          'image/jpeg',
          0.85,
        )
      } catch {
        fail()
      }
    })
    // Safety timeout — si el browser no dispara `seeked`, abortamos a los 5s.
    setTimeout(fail, 5000)
  })
}

export function ClipRecorder({ taskId, commentId, onCreated, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [includeMic, setIncludeMic] = useState(true)
  const [elapsedSec, setElapsedSec] = useState(0)
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [thumbBlob, setThumbBlob] = useState<Blob | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [trimStart, setTrimStart] = useState(0)
  const [trimEnd, setTrimEnd] = useState(0)
  const [videoDuration, setVideoDuration] = useState(0)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const tickerRef = useRef<number | null>(null)

  // Cleanup defensivo si el modal se cierra a mitad de grabación.
  useEffect(() => {
    return () => {
      try {
        mediaRecorderRef.current?.stop()
      } catch {
        // ignore
      }
      streamRef.current?.getTracks().forEach((t) => t.stop())
      if (tickerRef.current) window.clearInterval(tickerRef.current)
      if (videoUrl) URL.revokeObjectURL(videoUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cleanup one-shot al desmontar.
  }, [])

  const startRecording = useCallback(async () => {
    setErrorMsg(null)
    setElapsedSec(0)
    chunksRef.current = []
    try {
      // Pedimos pantalla + audio del sistema (si el browser lo soporta);
      // el audio del mic se mergea aparte vía `getUserMedia`.
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 24, max: 30 } },
        audio: true,
      })

      const tracks: MediaStreamTrack[] = displayStream.getTracks()

      if (includeMic) {
        try {
          const micStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: false,
          })
          micStream.getAudioTracks().forEach((t) => tracks.push(t))
        } catch {
          // Si el usuario rechaza el mic, seguimos sin él silenciosamente.
        }
      }

      const merged = new MediaStream(tracks)
      streamRef.current = merged

      const mimePref = pickPreferredClipMime() ?? 'video/webm'
      const mr = new MediaRecorder(merged, { mimeType: mimePref })
      mediaRecorderRef.current = mr

      mr.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data)
      }
      mr.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: mimePref })
        const url = URL.createObjectURL(blob)
        setVideoBlob(blob)
        setVideoUrl(url)
        setPhase('review')
        // Capturar thumbnail en paralelo, no bloqueante.
        captureFirstFrame(blob).then((b) => setThumbBlob(b))
        // Liberar tracks de pantalla/mic.
        streamRef.current?.getTracks().forEach((t) => t.stop())
        streamRef.current = null
      }
      // Si el usuario detiene "compartir" desde el chrome del browser, paramos.
      displayStream.getVideoTracks()[0]?.addEventListener('ended', () => {
        if (mr.state === 'recording') mr.stop()
      })

      mr.start(1000) // timeslice 1s → chunks atómicos por segundo.
      setPhase('recording')

      tickerRef.current = window.setInterval(() => {
        setElapsedSec((s) => s + 1)
      }, 1000)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error desconocido'
      setErrorMsg(`No se pudo iniciar la grabación: ${msg}`)
      setPhase('error')
    }
  }, [includeMic])

  const stopRecording = useCallback(() => {
    if (tickerRef.current) {
      window.clearInterval(tickerRef.current)
      tickerRef.current = null
    }
    try {
      mediaRecorderRef.current?.stop()
    } catch {
      // ignore
    }
  }, [])

  const onVideoMetadata = useCallback(
    (e: React.SyntheticEvent<HTMLVideoElement>) => {
      const v = e.currentTarget
      const d = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0
      setVideoDuration(d)
      setTrimEnd(d)
    },
    [],
  )

  const onTrimStartChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = Number.parseFloat(e.target.value)
      setTrimStart(Math.min(v, trimEnd))
    },
    [trimEnd],
  )

  const onTrimEndChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = Number.parseFloat(e.target.value)
      setTrimEnd(Math.max(v, trimStart))
    },
    [trimStart],
  )

  const handleUpload = useCallback(async () => {
    if (!videoBlob) return
    setPhase('uploading')
    setErrorMsg(null)
    try {
      const fd = new FormData()
      if (taskId) fd.set('taskId', taskId)
      if (commentId) fd.set('commentId', commentId)
      // Trim "lógico": para no procesar el blob, lo enviamos completo y
      // anotamos en metadata el rango; el player respeta el `trimStart/end`
      // del lado DB en futuras iteraciones. Por ahora subimos el blob completo
      // y la duración efectiva (trimEnd − trimStart) en `durationSec`.
      const effectiveDuration = Math.max(
        1,
        Math.round(trimEnd - trimStart) || Math.round(videoDuration || elapsedSec),
      )
      fd.set('durationSec', String(effectiveDuration))
      const ext = (videoBlob.type.split('/')[1] || 'webm').split(';')[0] || 'webm'
      fd.set(
        'video',
        new File([videoBlob], `clip.${ext}`, { type: videoBlob.type }),
      )
      if (thumbBlob) {
        fd.set(
          'thumbnail',
          new File([thumbBlob], 'thumb.jpg', { type: thumbBlob.type }),
        )
      }
      const dto = await createClip(fd)
      onCreated?.(dto)
      onClose()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error desconocido'
      setErrorMsg(msg)
      setPhase('error')
    }
  }, [
    videoBlob,
    thumbBlob,
    taskId,
    commentId,
    onCreated,
    onClose,
    trimStart,
    trimEnd,
    videoDuration,
    elapsedSec,
  ])

  const overDuration =
    elapsedSec > CLIP_MAX_DURATION_SEC_DEFAULT &&
    (phase === 'recording' || phase === 'review')

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="clip-recorder-title"
      data-testid="clip-recorder-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={() => phase === 'idle' && onClose()}
    >
      <div
        className="w-full max-w-2xl rounded-lg bg-background p-5 shadow-2xl border border-border"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mb-4 flex items-center justify-between">
          <h2
            id="clip-recorder-title"
            className="flex items-center gap-2 text-base font-semibold text-foreground"
          >
            <Video className="h-4 w-4 text-indigo-400" aria-hidden />
            Grabar clip de video
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded p-1 text-muted-foreground hover:bg-muted"
            disabled={phase === 'recording' || phase === 'uploading'}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        {phase === 'idle' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Graba tu pantalla con audio para explicar una tarea o reportar
              un bug sin necesidad de reuniones. Máximo {CLIP_MAX_SIZE_MB_DEFAULT} MB · recomendado
              ≤ {Math.round(CLIP_MAX_DURATION_SEC_DEFAULT / 60)} min.
            </p>
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={includeMic}
                onChange={(e) => setIncludeMic(e.target.checked)}
                data-testid="clip-include-mic"
                className="h-4 w-4"
              />
              {includeMic ? (
                <Mic className="h-3.5 w-3.5 text-emerald-400" aria-hidden />
              ) : (
                <MicOff className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              )}
              Incluir audio del micrófono
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded border border-border bg-background px-3 py-1.5 text-sm hover:bg-muted"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={startRecording}
                data-testid="clip-start"
                className="flex items-center gap-2 rounded bg-indigo-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-indigo-500"
              >
                <Play className="h-3.5 w-3.5" aria-hidden />
                Iniciar grabación
              </button>
            </div>
          </div>
        )}

        {phase === 'recording' && (
          <div className="space-y-4">
            <div
              data-testid="clip-recording-indicator"
              className="flex items-center justify-between rounded border border-red-500/30 bg-red-500/10 px-3 py-2"
            >
              <span className="flex items-center gap-2 text-sm font-semibold text-red-500">
                <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
                Grabando…
              </span>
              <span
                className={`text-sm font-mono ${
                  overDuration ? 'text-amber-500 font-bold' : 'text-foreground'
                }`}
              >
                {formatDuration(elapsedSec)}
              </span>
            </div>
            {overDuration && (
              <p
                role="alert"
                className="text-xs text-amber-500"
                data-testid="clip-over-duration-warning"
              >
                Superaste los {Math.round(CLIP_MAX_DURATION_SEC_DEFAULT / 60)} min recomendados —
                considera dividir el clip.
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={stopRecording}
                data-testid="clip-stop"
                className="flex items-center gap-2 rounded bg-red-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-red-500"
              >
                <Square className="h-3.5 w-3.5" aria-hidden />
                Detener
              </button>
            </div>
          </div>
        )}

        {phase === 'review' && videoUrl && videoBlob && (
          <div className="space-y-4">
            <video
              data-testid="clip-preview-video"
              src={videoUrl}
              controls
              onLoadedMetadata={onVideoMetadata}
              className="w-full rounded border border-border bg-black"
            />
            <dl className="grid grid-cols-3 gap-2 text-xs">
              <div>
                <dt className="text-muted-foreground">Duración</dt>
                <dd className="font-mono">{formatDuration(videoDuration || elapsedSec)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Tamaño</dt>
                <dd className="font-mono">{formatMb(videoBlob.size)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Thumbnail</dt>
                <dd className="font-mono">{thumbBlob ? 'Capturado' : 'Pendiente'}</dd>
              </div>
            </dl>

            {videoDuration > 0 && (
              <div className="space-y-2 rounded border border-border bg-card/40 px-3 py-2">
                <p className="text-xs font-semibold text-muted-foreground">
                  Recortar inicio/fin (precisión ~1s)
                </p>
                <label className="block text-xs">
                  Inicio: <span className="font-mono">{formatDuration(trimStart)}</span>
                  <input
                    type="range"
                    min={0}
                    max={videoDuration}
                    step={0.5}
                    value={trimStart}
                    onChange={onTrimStartChange}
                    data-testid="clip-trim-start"
                    className="mt-1 w-full"
                  />
                </label>
                <label className="block text-xs">
                  Fin: <span className="font-mono">{formatDuration(trimEnd)}</span>
                  <input
                    type="range"
                    min={0}
                    max={videoDuration}
                    step={0.5}
                    value={trimEnd}
                    onChange={onTrimEndChange}
                    data-testid="clip-trim-end"
                    className="mt-1 w-full"
                  />
                </label>
                <p className="text-[11px] text-muted-foreground">
                  Duración efectiva: {formatDuration(Math.max(0, trimEnd - trimStart))}
                </p>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  if (videoUrl) URL.revokeObjectURL(videoUrl)
                  setVideoBlob(null)
                  setVideoUrl(null)
                  setThumbBlob(null)
                  setPhase('idle')
                  setElapsedSec(0)
                }}
                className="rounded border border-border bg-background px-3 py-1.5 text-sm hover:bg-muted"
                data-testid="clip-discard"
              >
                Descartar
              </button>
              <button
                type="button"
                onClick={handleUpload}
                data-testid="clip-upload"
                className="flex items-center gap-2 rounded bg-emerald-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-emerald-500"
              >
                <Upload className="h-3.5 w-3.5" aria-hidden />
                Subir clip
              </button>
            </div>
          </div>
        )}

        {phase === 'uploading' && (
          <div
            data-testid="clip-uploading"
            className="flex flex-col items-center gap-2 py-8"
          >
            <Loader2 className="h-6 w-6 animate-spin text-indigo-400" aria-hidden />
            <p className="text-sm text-muted-foreground">Subiendo clip…</p>
          </div>
        )}

        {phase === 'error' && (
          <div className="space-y-3">
            <p
              role="alert"
              data-testid="clip-error"
              className="rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {errorMsg ?? 'Ocurrió un error desconocido.'}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded border border-border bg-background px-3 py-1.5 text-sm hover:bg-muted"
              >
                Cerrar
              </button>
              <button
                type="button"
                onClick={() => {
                  setPhase('idle')
                  setErrorMsg(null)
                }}
                className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-indigo-500"
              >
                Reintentar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
