import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import type { DemoDomain } from '@/api/types'

export function useDemoDomains(): DemoDomain[] {
  const [demos, setDemos] = useState<DemoDomain[]>([])
  useEffect(() => {
    const controller = new AbortController()
    api.demoDomains(controller.signal).then(setDemos).catch(() => setDemos([]))
    return () => controller.abort()
  }, [])
  return demos
}
