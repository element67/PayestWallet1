import { useTheme } from '@/lib/theme'

/**
 * The graphic background. Abstract shapes only (blobs, rings, torn paper edges, tape strips), flat colour, thick dark outlines.
 * Every colour is a theme variable, so switching theme repaints the artwork instantly. Three compositions are shared out
 * across the ten themes. Large shapes use colours the page text can sit on; the bold colours are kept to small accents.
 */

/** A torn paper edge: a jagged strip from `y0` to `y1` that is ragged along its far side. */
function tornPath(width: number, y0: number, y1: number, seed: number, edge: 'top' | 'bottom') {
  const pts: string[] = []
  const step = 22
  for (let x = -10; x <= width + step; x += step) {
    const jag = ((x * 31 + seed * 17) % 13) - 6
    pts.push(`${x},${(edge === 'bottom' ? y0 : y1) + jag * 1.6}`)
  }
  const far = edge === 'bottom' ? y1 : y0
  return `M-10,${far} L${pts.join(' L')} L${width + step},${far} Z`
}

const Tape = ({ x, y, w = 120, h = 32, r, cls = 'art-fill-4' }: { x: number; y: number; w?: number; h?: number; r: number; cls?: string }) => (
  <g transform={`rotate(${r} ${x + w / 2} ${y + h / 2})`}>
    <rect x={x} y={y} width={w} height={h} rx="3" className={`${cls} art-outline`} />
    <path d={`M${x + 12} ${y + 8} H${x + w - 12} M${x + 12} ${y + h - 8} H${x + w - 12}`} className="art-stroke-ink" strokeWidth="2" strokeDasharray="5 7" opacity="0.5" />
  </g>
)

const Ring = ({ cx, cy, r, w = 26, cls = 'art-stroke-4' }: { cx: number; cy: number; r: number; w?: number; cls?: string }) => (
  <g>
    <circle cx={cx} cy={cy} r={r} className="art-outline" fill="none" strokeWidth={w + 8} />
    <circle cx={cx} cy={cy} r={r} className={cls} strokeWidth={w} />
  </g>
)

const Dots = ({ x, y, cls = 'art-fill-4' }: { x: number; y: number; cls?: string }) => (
  <g>
    {[0, 1, 2].flatMap((i) => [0, 1, 2].map((j) => <circle key={`${i}-${j}`} cx={x + i * 18} cy={y + j * 18} r="4.5" className={cls} />))}
  </g>
)

function CompositionA() {
  return (
    <>
      <path d="M-60 40 C 10 -70, 220 -40, 250 80 C 275 180, 130 250, 30 215 C -50 185, -95 120, -60 40 Z" className="art-fill-1 art-outline" />
      <path d={tornPath(400, 640, 860, 3, 'bottom')} className="art-fill-3 art-outline" />
      <path d="M330 330 C 420 300, 470 400, 440 480 C 410 560, 300 540, 280 460 C 265 400, 285 345, 330 330 Z" className="art-fill-2 art-outline" />
      <Ring cx={350} cy={690} r={92} />
      <Ring cx={20} cy={470} r={60} w={18} cls="art-stroke-5" />
      <Tape x={250} y={46} r={24} />
      <Tape x={-20} y={720} w={130} r={-18} cls="art-fill-5" />
      <Dots x={330} y={250} />
    </>
  )
}

function CompositionB() {
  return (
    <>
      <circle cx="360" cy="120" r="170" className="art-fill-1 art-outline" />
      <path d={tornPath(400, 0, 120, 7, 'top')} className="art-fill-3 art-outline" />
      <path d="M-70 420 C -10 360, 140 380, 170 470 C 195 560, 80 640, -20 620 C -90 600, -110 480, -70 420 Z" className="art-fill-2 art-outline" />
      <Ring cx={60} cy={150} r={70} w={20} />
      <Tape x={-30} y={560} r={-32} w={150} />
      <Tape x={270} y={640} r={14} w={140} cls="art-fill-5" />
      <circle cx="330" cy="560" r="46" className="art-fill-6 art-outline" />
      <Dots x={300} y={330} cls="art-fill-5" />
    </>
  )
}

function CompositionC() {
  return (
    <>
      <path d="M0 0 H400 V210 C 330 170, 300 250, 220 230 C 140 210, 100 280, 0 240 Z" className="art-fill-1 art-outline" />
      <path d="M440 430 C 360 390, 270 450, 300 540 C 330 630, 450 650, 470 570 Z" className="art-fill-3 art-outline" />
      <path d={tornPath(400, 700, 860, 11, 'bottom')} className="art-fill-2 art-outline" />
      <Ring cx={330} cy={250} r={44} w={16} />
      <Ring cx={330} cy={250} r={86} w={12} cls="art-stroke-5" />
      <Tape x={-30} y={380} r={-24} w={140} />
      <Tape x={230} y={760} r={-10} w={150} cls="art-fill-4" />
      <circle cx="60" cy="560" r="38" className="art-fill-4 art-outline" />
      <Dots x={332} y={520} cls="art-fill-5" />
    </>
  )
}

export function Backdrop() {
  const { art } = useTheme()
  return (
    <div className="backdrop" aria-hidden="true" data-art={art}>
      <svg viewBox="0 0 400 800" preserveAspectRatio="xMidYMid slice">
        {art === 0 && <CompositionA />}
        {art === 1 && <CompositionB />}
        {art === 2 && <CompositionC />}
      </svg>
    </div>
  )
}
