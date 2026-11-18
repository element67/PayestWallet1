import { useQuery } from '@tanstack/react-query'
import { api } from './api'
import { useSession } from './session'

export interface Profile {
  fullName: string; email: string; phone: string | null; avatarUrl: string | null
  verificationStatus: string; tier: number; memberSince: number; updatedAt: number
}

/** The signed-in user's own profile. The same query key is used by the header and the Profile page, so a change shows in both. */
export function useProfile() {
  const { user } = useSession()
  return useQuery({
    queryKey: ['profile', user?.id],
    enabled: Boolean(user),
    queryFn: () => api<{ profile: Profile }>('/api/profile').then((r) => r.profile),
  })
}

export interface SupportInfo {
  channels: { ai: string | null; telegram: string | null; email: string | null }
  faqs: { q: string; a: string }[]
}

/** Support channels configured by the operator, and the FAQs. */
export function useSupport() {
  return useQuery({ queryKey: ['support'], queryFn: () => api<SupportInfo>('/api/support'), staleTime: 5 * 60_000 })
}

export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '?'
