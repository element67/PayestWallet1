/**
 * Type shim for the chain registry that scripts/compass-deploy.ts imports. The package ships with the Arc Studio
 * workspace but is not listed in package.json, so a plain clone could not typecheck without this declaration.
 * Only the fields the script reads are described.
 */
declare module '@circlefin/compass-chains' {
  export interface ChainDefinition {
    name: string
    explorerUrl?: string
    nativeCurrency: { symbol: string; decimals?: number }
    [key: string]: unknown
  }
  export function getChain(key: string): ChainDefinition
}
