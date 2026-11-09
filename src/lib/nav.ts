/** Where a Home action should land. Screens open straight on the matching form. */
export type Intent = {
  screen?: 'send' | 'receive' | 'swap' | 'bridge' | 'buy' | 'sell' | 'transfer'
  side?: 'sell' | 'buy'
}
