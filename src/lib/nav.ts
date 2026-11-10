export type SettingsPage = 'list' | 'display' | 'appearance' | 'textsize' | 'notifications' | 'security' | 'linked' | 'help'

/** Where a Home action should land. Screens open straight on the matching form. */
export type Intent = {
  screen?: 'send' | 'receive' | 'swap' | 'bridge' | 'buy' | 'sell' | 'transfer'
  side?: 'sell' | 'buy'
  /** Which Settings page to open (the top bar's sun icon opens 'appearance'). */
  settings?: SettingsPage
}
