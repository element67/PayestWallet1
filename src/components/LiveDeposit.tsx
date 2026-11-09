import { useEffect, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { erc20Abi, type Address } from 'viem'
import { useAccount, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { toast } from 'sonner'
import { api, type Order } from '@/lib/api'
import { parseAmount } from '@/onchain-money'
import { buildTxExplorerUrl } from '@/onchain-facts'
import { parseError } from '@/lib/format'
import { useSession } from '@/lib/session'
import { Button } from './ui'

/** Real USDC transfer on Arc Testnet to the vault. The backend agent detects it independently of this component. */
export function LiveDeposit({ order }: { order: Order }) {
  const { config } = useSession()
  const qc = useQueryClient()
  const { address, chainId, isConnected } = useAccount()
  const { switchChain, isPending: switching } = useSwitchChain()
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract()
  const { isLoading: confirming } = useWaitForTransactionReceipt({ hash })
  const reported = useRef<string | null>(null)

  const report = useMutation({
    mutationFn: (txHash: string) => api(`/api/orders/${order.id}/broadcast`, { method: 'POST', body: { txHash } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['order', order.id] }),
    onError: (e) => toast.error(e.message),
  })

  // Tell the agent the moment the wallet has broadcast, so it can watch the pending transaction.
  useEffect(() => {
    if (hash && reported.current !== hash) {
      reported.current = hash
      report.mutate(hash)
    }
  }, [hash, report])

  if (!config || !order.depositAddress) return null
  const wrongAccount = isConnected && address?.toLowerCase() !== order.fromAddress?.toLowerCase()
  const wrongChain = isConnected && chainId !== config.chainId

  const send = () => {
    if (wrongChain) return switchChain({ chainId: config.chainId })
    reset()
    writeContract({
      address: config.usdcAddress as Address,
      abi: erc20Abi,
      functionName: 'transfer',
      args: [order.depositAddress as Address, parseAmount(config.chainId, order.cryptoAmount).raw],
      chainId: config.chainId,
    })
  }

  return (
    <div className="rounded-2xl border border-line bg-muted p-4">
      <div className="text-sm font-semibold">Send {order.cryptoAmount} USDC on Arc Testnet</div>
      <p className="mt-1 text-pretty text-xs text-subtle">
        Approve once in your wallet. The agent sees the transaction as soon as it is broadcast, then pays out when the evidence checks out.
      </p>
      <div className="mono mt-2 break-all text-xs text-ink-2">To vault: {order.depositAddress}</div>
      <div className="mt-3">
        {!isConnected ? (
          <ConnectKitButton />
        ) : wrongAccount ? (
          <p className="text-sm text-danger">Switch your wallet to {order.fromAddress} (the address you started this order with).</p>
        ) : (
          <Button onClick={send} loading={isPending || switching || confirming} className="w-full">
            {wrongChain ? 'Switch to Arc Testnet' : isPending ? 'Confirm in wallet...' : confirming ? 'Broadcast. Waiting...' : hash ? 'Sent' : 'Approve and send'}
          </Button>
        )}
        {error && <p className="mt-2 text-sm text-danger">{parseError(error)}</p>}
        {hash && (
          <a className="mt-2 block text-xs underline" target="_blank" rel="noopener noreferrer" href={buildTxExplorerUrl(config.chainId, hash)}>
            View transaction on the explorer
          </a>
        )}
      </div>
    </div>
  )
}
