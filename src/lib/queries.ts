import { useQuery } from '@tanstack/react-query'
import { api, type Asset, type Balances, type BankAccount, type Notification, type Order } from './api'

const live = 2000

export const useAssets = () => useQuery({ queryKey: ['assets'], queryFn: () => api<{ assets: Asset[] }>('/api/assets').then((r) => r.assets), refetchInterval: 10000 })
export const useBalances = () => useQuery({ queryKey: ['balances'], queryFn: () => api<Balances>('/api/balances'), refetchInterval: live })
export const useOrders = () => useQuery({ queryKey: ['orders'], queryFn: () => api<{ orders: Order[] }>('/api/orders').then((r) => r.orders), refetchInterval: live })
export const useOrder = (id: string | null) =>
  useQuery({ queryKey: ['order', id], enabled: Boolean(id), queryFn: () => api<{ order: Order }>(`/api/orders/${id}`).then((r) => r.order), refetchInterval: live })
export const useBanks = () => useQuery({ queryKey: ['banks'], queryFn: () => api<{ accounts: BankAccount[] }>('/api/bank-accounts').then((r) => r.accounts) })
export const useNotifications = () =>
  useQuery({ queryKey: ['notifications'], queryFn: () => api<{ notifications: Notification[] }>('/api/notifications').then((r) => r.notifications), refetchInterval: 5000 })

export const TERMINAL = ['completed', 'failed', 'expired', 'cancelled', 'rejected', 'reversed']
