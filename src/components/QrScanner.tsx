import { useCallback, useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'
import { ImageUp, ScanLine } from 'lucide-react'
import { parseScan, scanIntent } from '@/lib/qr'
import type { Intent } from '@/lib/nav'
import type { View } from './Shell'
import { Sheet } from './naira/Sheet'
import { Button } from './ui'

type Detector = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> }
const nativeDetector = (): Detector | null => {
  const Ctor = (globalThis as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector
  try {
    return Ctor ? new Ctor({ formats: ['qr_code'] }) : null
  } catch {
    return null
  }
}

/** Reads a QR code from an image file the user picked (for when the camera is not available). */
async function decodeFile(file: File): Promise<string | null> {
  const bmp = await createImageBitmap(file)
  const longest = Math.max(bmp.width, bmp.height)
  // Large pictures are shrunk to keep decoding quick; small ones are enlarged so each QR square is several pixels wide.
  const scale = longest > 1200 ? 1200 / longest : longest < 500 ? 500 / longest : 1
  const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  // A picture with a transparent background would read as black, so it is drawn on white first.
  ctx.imageSmoothingEnabled = scale <= 1
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(bmp, 0, 0, w, h)
  return jsQR(ctx.getImageData(0, 0, w, h).data, w, h)?.data ?? null
}

function Scanner({ onText }: { onText: (text: string) => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const hasCamera = typeof navigator !== 'undefined' && 'mediaDevices' in navigator && Boolean(navigator.mediaDevices)
  const [camera, setCamera] = useState<'starting' | 'on' | 'off'>(hasCamera ? 'starting' : 'off')
  const [note, setNote] = useState<string | null>(hasCamera ? null : 'This browser cannot open the camera. Choose a picture of the QR code instead.')
  const done = useRef(false)

  const found = useCallback((text: string) => {
    if (done.current) return
    done.current = true
    onText(text)
  }, [onText])

  useEffect(() => {
    const run = { stream: null as MediaStream | null, stopped: false, id: 0 }
    const detector = nativeDetector()
    const canvas = document.createElement('canvas')

    const tick = async () => {
      const v = video.current
      if (run.stopped || done.current || !v) return
      if (v.readyState >= 2 && v.videoWidth > 0) {
        try {
          if (detector) {
            const codes = await detector.detect(v)
            if (codes[0]?.rawValue) return found(codes[0].rawValue)
          } else {
            const scale = Math.min(1, 640 / v.videoWidth)
            canvas.width = Math.round(v.videoWidth * scale)
            canvas.height = Math.round(v.videoHeight * scale)
            const ctx = canvas.getContext('2d', { willReadFrequently: true })
            if (ctx) {
              ctx.drawImage(v, 0, 0, canvas.width, canvas.height)
              const hit = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height)
              if (hit?.data) return found(hit.data)
            }
          }
        } catch {
          /* a frame that cannot be read is skipped */
        }
      }
      run.id = window.setTimeout(() => void tick(), 180)
    }

    if (!hasCamera) return
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      .then(async (s) => {
        if (run.stopped) return s.getTracks().forEach((t) => t.stop())
        run.stream = s
        if (video.current) {
          video.current.srcObject = s
          await video.current.play().catch(() => undefined)
        }
        setCamera('on')
        void tick()
      })
      .catch(() => {
        setCamera('off')
        setNote('The camera is blocked or not available. Allow camera access in your browser, or choose a picture of the QR code instead.')
      })
    return () => {
      run.stopped = true
      window.clearTimeout(run.id)
      run.stream?.getTracks().forEach((t) => t.stop())
    }
  }, [found, hasCamera])

  const pick = async (file: File | undefined) => {
    if (!file) return
    try {
      const text = await decodeFile(file)
      if (text) found(text)
      else setNote('No QR code was found in that picture.')
    } catch {
      setNote('That file could not be read as a picture.')
    }
  }

  return (
    <div className="space-y-4">
      <div className="relative mx-auto aspect-square w-full max-w-sm overflow-hidden rounded-3xl bg-surface-strong">
        <video ref={video} className="size-full object-cover" playsInline muted aria-label="Camera view" />
        {camera !== 'on' && (
          <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm font-semibold text-subtle">
            <span className="flex flex-col items-center gap-2"><ScanLine size={32} />{camera === 'starting' ? 'Opening the camera' : 'Camera is off'}</span>
          </div>
        )}
        {camera === 'on' && <div className="pointer-events-none absolute inset-8 rounded-3xl border-2 border-accent" aria-hidden="true" />}
      </div>
      <p className="text-center text-sm font-medium text-ink-2">Point the camera at a wallet address QR code. You review and confirm the payment on the next screen.</p>
      {note && <p role="alert" className="rounded-2xl bg-danger px-3 py-2 text-sm font-bold text-on-danger">{note}</p>}
      <label className="block">
        <input type="file" accept="image/*" className="sr-only" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = '' }} />
        <span className="border border-outline flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-full bg-surface-strong px-6 text-sm font-semibold text-ink"><ImageUp size={16} /> Choose a QR picture</span>
      </label>
    </div>
  )
}

/** Scans a payment QR code and opens the existing Send screen with the address filled in. */
export function QrScannerSheet({ open, onClose, go }: { open: boolean; onClose: () => void; go: (v: View, i?: Intent) => void }) {
  const [unknown, setUnknown] = useState<string | null>(null)
  const [round, setRound] = useState(0)

  const handle = useCallback((text: string) => {
    const r = parseScan(text)
    if (r.kind === 'crypto') {
      onClose()
      go('crypto', scanIntent(r))
    } else {
      setUnknown(r.text)
    }
  }, [go, onClose])

  const close = () => { setUnknown(null); onClose() }

  return (
    <Sheet open={open} onClose={close} title="Scan to pay">
      {unknown !== null ? (
        <div className="space-y-4 pb-2">
          <p role="alert" className="rounded-2xl bg-warn/15 px-3 py-3 text-sm font-semibold text-warn">This is not a payment code that Payest can pay. Nothing was sent.</p>
          <div className="mono break-all rounded-2xl bg-muted px-3 py-2.5 text-xs">{unknown || '(empty code)'}</div>
          <Button className="w-full" onClick={() => { setUnknown(null); setRound((r) => r + 1) }}>Scan again</Button>
        </div>
      ) : (
        <Scanner key={round} onText={handle} />
      )}
    </Sheet>
  )
}
