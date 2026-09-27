import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import type { RecentScan } from '@/api/types'

/** Recently scanned domains; pass a value that changes after each scan to refresh. */
export function useRecent(refreshKey: unknown): RecentScan[] {
  const [items, setItems] = useState<RecentScan[]>([])
  useEffect(() => {
    const controller = new AbortController()
    api.recent(8, controller.signal).then(setItems).catch(() => {})
    return () => controller.abort()
  }, [refreshKey])
  return items
}
