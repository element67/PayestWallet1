/**
 * Sandbox bill catalog: categories, providers, packages and prices. All prices are illustrative sandbox values,
 * not live tariffs. A production provider adapter would return these from its own catalog API.
 */
export interface Pkg { id: string; label: string; validity?: string; priceKobo: number }
export interface Category {
  id: string
  label: string
  customerLabel: string
  customerPattern: string
  verify: boolean
  mode: 'amount' | 'package'
  minKobo?: number
  maxKobo?: number
  providers: { id: string; label: string }[]
  variants?: { id: string; label: string }[]
  packages?: Record<string, Pkg[]> // by provider id; '*' applies to all
  note: string
}

const net = (items: string[]) => items.map((l) => ({ id: l.toLowerCase().replace(/[^a-z0-9]+/g, '-'), label: l }))
const NETWORKS = net(['MTN', 'Airtel', 'Glo', '9mobile'])
const bundles: Pkg[] = [
  { id: 'd-500mb-1d', label: '500 MB', validity: '1 day', priceKobo: 20000 },
  { id: 'd-1gb-1d', label: '1 GB', validity: '1 day', priceKobo: 35000 },
  { id: 'd-2gb-7d', label: '2 GB', validity: '7 days', priceKobo: 70000 },
  { id: 'd-5gb-30d', label: '5 GB', validity: '30 days', priceKobo: 150000 },
  { id: 'd-10gb-30d', label: '10 GB', validity: '30 days', priceKobo: 270000 },
  { id: 'd-20gb-30d', label: '20 GB', validity: '30 days', priceKobo: 500000 },
]

export const CATEGORIES: Category[] = [
  { id: 'airtime', label: 'Airtime', customerLabel: 'Phone number', customerPattern: '^0[789][01]\\d{8}$', verify: false, mode: 'amount', minKobo: 5000, maxKobo: 5_000_000, providers: NETWORKS, note: 'Instant top-up (sandbox).' },
  { id: 'data', label: 'Data', customerLabel: 'Phone number', customerPattern: '^0[789][01]\\d{8}$', verify: false, mode: 'package', providers: NETWORKS, packages: { '*': bundles }, note: 'Sandbox bundles and prices.' },
  {
    id: 'electricity', label: 'Electricity', customerLabel: 'Meter number', customerPattern: '^\\d{11,13}$', verify: true, mode: 'amount', minKobo: 50000, maxKobo: 20_000_000,
    providers: net(['Ikeja Electric', 'Eko Electric', 'Abuja Electric', 'Ibadan Electric', 'Enugu Electric', 'Port Harcourt Electric', 'Kano Electric', 'Kaduna Electric', 'Jos Electric', 'Benin Electric']),
    variants: [{ id: 'prepaid', label: 'Prepaid' }, { id: 'postpaid', label: 'Postpaid' }], note: 'Prepaid payments return a token (sandbox).',
  },
  {
    id: 'cable', label: 'Cable TV', customerLabel: 'Smartcard / IUC number', customerPattern: '^\\d{10,11}$', verify: true, mode: 'package', providers: net(['DStv', 'GOtv', 'StarTimes', 'Showmax']),
    packages: {
      dstv: [{ id: 'dstv-padi', label: 'Padi', validity: '30 days', priceKobo: 440000 }, { id: 'dstv-yanga', label: 'Yanga', validity: '30 days', priceKobo: 600000 }, { id: 'dstv-compact', label: 'Compact', validity: '30 days', priceKobo: 1500000 }],
      gotv: [{ id: 'gotv-supa', label: 'Supa', validity: '30 days', priceKobo: 760000 }, { id: 'gotv-max', label: 'Max', validity: '30 days', priceKobo: 570000 }, { id: 'gotv-jolli', label: 'Jolli', validity: '30 days', priceKobo: 390000 }],
      startimes: [{ id: 'st-nova', label: 'Nova', validity: '30 days', priceKobo: 180000 }, { id: 'st-classic', label: 'Classic', validity: '30 days', priceKobo: 380000 }],
      showmax: [{ id: 'sm-mobile', label: 'Mobile', validity: '30 days', priceKobo: 120000 }, { id: 'sm-standard', label: 'Standard', validity: '30 days', priceKobo: 290000 }],
    },
    note: 'Sandbox packages and prices.',
  },
  { id: 'water', label: 'Water', customerLabel: 'Customer account number', customerPattern: '^\\d{8,12}$', verify: true, mode: 'amount', minKobo: 50000, maxKobo: 10_000_000, providers: net(['Lagos Water Corporation', 'FCT Water Board', 'Ogun State Water Corporation', 'Kano State Water Board', 'Rivers State Water Board']), note: 'Water bill payment (sandbox).' },
  {
    id: 'internet', label: 'Internet', customerLabel: 'Customer / device ID', customerPattern: '^\\d{8,12}$', verify: true, mode: 'package', providers: net(['Smile', 'Spectranet']),
    packages: { '*': [{ id: 'net-10gb', label: '10 GB', validity: '30 days', priceKobo: 350000 }, { id: 'net-30gb', label: '30 GB', validity: '30 days', priceKobo: 900000 }, { id: 'net-100gb', label: '100 GB', validity: '30 days', priceKobo: 2500000 }] }, note: 'Broadband bundles (sandbox).',
  },
  {
    id: 'education', label: 'Education', customerLabel: 'Phone number', customerPattern: '^0[789][01]\\d{8}$', verify: false, mode: 'package', providers: net(['WAEC', 'NECO', 'JAMB']),
    packages: { waec: [{ id: 'waec-result', label: 'Result checker PIN', priceKobo: 350000 }], neco: [{ id: 'neco-token', label: 'Result token', priceKobo: 120000 }], jamb: [{ id: 'jamb-epin', label: 'UTME e-PIN', priceKobo: 620000 }] }, note: 'Returns a PIN after payment (sandbox).',
  },
]

export const getCategory = (id: string) => CATEGORIES.find((c) => c.id === id)

export function packagesFor(cat: Category, provider: string): Pkg[] {
  return cat.packages?.[provider] ?? cat.packages?.['*'] ?? []
}

/* ---------------- flights (simulated inventory) ---------------- */

export const AIRPORTS = [
  { code: 'LOS', city: 'Lagos' }, { code: 'ABV', city: 'Abuja' }, { code: 'PHC', city: 'Port Harcourt' }, { code: 'KAN', city: 'Kano' },
  { code: 'ENU', city: 'Enugu' }, { code: 'QUO', city: 'Uyo' }, { code: 'BNI', city: 'Benin City' }, { code: 'CBQ', city: 'Calabar' },
] as const
export const AIRLINES = ['Sandbox Air', 'Demo Wings', 'Test Jet Nigeria'] as const

export interface FlightOffer { id: string; airline: string; flightNo: string; from: string; to: string; date: string; departs: string; arrives: string; durationMin: number; priceKobo: number; seats: number }

/** Deterministic offers for a route and date: the same search always returns the same simulated inventory. */
export function searchFlights(from: string, to: string, date: string): FlightOffer[] {
  const seed = [...`${from}${to}${date}`].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7)
  const base = 4_500_000 + (seed % 2_000_000)
  return AIRLINES.flatMap((airline, i) =>
    [0, 1].map((k) => {
      const hour = 6 + ((seed + i * 5 + k * 7) % 14)
      const dur = 55 + ((seed >> (i + k)) % 40)
      const dep = `${String(hour).padStart(2, '0')}:${k ? '30' : '00'}`
      const arrMin = hour * 60 + (k ? 30 : 0) + dur
      return {
        id: `${from}-${to}-${date}-${i}${k}`, airline, flightNo: `${airline.split(' ').map((w) => w[0]).join('')}${100 + ((seed + i * 17 + k * 3) % 800)}`, from, to, date,
        departs: dep, arrives: `${String(Math.floor(arrMin / 60) % 24).padStart(2, '0')}:${String(arrMin % 60).padStart(2, '0')}`, durationMin: dur,
        priceKobo: base + i * 350_000 + k * 220_000, seats: 4 + ((seed + i + k) % 9),
      }
    }),
  ).sort((a, b) => a.priceKobo - b.priceKobo)
}

export const getOffer = (id: string): FlightOffer | undefined => {
  const m = /^([A-Z]{3})-([A-Z]{3})-(\d{4}-\d{2}-\d{2})-\d\d$/.exec(id)
  return m ? searchFlights(m[1], m[2], m[3]).find((o) => o.id === id) : undefined
}

/* ---------------- shopping ---------------- */

export const SHOP_SEED = [
  { id: 'p-earbuds', category: 'Electronics', name: 'Wireless earbuds', description: 'Bluetooth earbuds with charging case.', price: 1850000, kind: 'physical' },
  { id: 'p-powerbank', category: 'Electronics', name: 'Power bank 20,000 mAh', description: 'Dual USB fast charging.', price: 2400000, kind: 'physical' },
  { id: 'p-speaker', category: 'Electronics', name: 'Portable speaker', description: 'Water-resistant speaker.', price: 3200000, kind: 'physical' },
  { id: 'p-ankara', category: 'Fashion', name: 'Ankara shirt', description: 'Cotton print shirt.', price: 1500000, kind: 'physical' },
  { id: 'p-sneakers', category: 'Fashion', name: 'Canvas sneakers', description: 'Everyday sneakers.', price: 2800000, kind: 'physical' },
  { id: 'p-blender', category: 'Home', name: 'Kitchen blender', description: '1.5 L glass jar blender.', price: 2950000, kind: 'physical' },
  { id: 'p-lamp', category: 'Home', name: 'Rechargeable lamp', description: 'LED lamp, 10 hour battery.', price: 1250000, kind: 'physical' },
  { id: 'g-play-5', category: 'Gift cards', name: 'Play Store gift card $5', description: 'Digital code delivered after payment.', price: 780000, kind: 'giftcard' },
  { id: 'g-play-10', category: 'Gift cards', name: 'Play Store gift card $10', description: 'Digital code delivered after payment.', price: 1500000, kind: 'giftcard' },
  { id: 'g-stream-15', category: 'Gift cards', name: 'Streaming gift card $15', description: 'Digital code delivered after payment.', price: 2300000, kind: 'giftcard' },
  { id: 'g-game-20', category: 'Gift cards', name: 'Game store gift card $20', description: 'Digital code delivered after payment.', price: 3000000, kind: 'giftcard' },
] as const
