export type SettingsPage = 'list' | 'display' | 'appearance' | 'textsize' | 'notifications' | 'security' | 'linked' | 'help'

/** Where a Home action should land. Screens open straight on the matching form. */
export type Intent = {
  screen?: 'send' | 'receive' | 'swap' | 'bridge' | 'buy' | 'sell' | 'transfer'
  side?: 'sell' | 'buy'
  /** A recipient address from a scanned QR code, filled into Send. */
  address?: string
  /** The network a Bridge should start from (for USDC held on a network the wallet has no balance list for). */
  from?: string
  /** Which Settings page to open (the top bar's sun icon opens 'appearance'). */
  settings?: SettingsPage
}
