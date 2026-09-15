import {Navigate, Outlet} from 'react-router-dom'

import {Button} from '@/components/ui/button'
import {usePlanStore} from '@/stores/planStore'

export default function MarketplaceAdminGate() {
  const authStatus = usePlanStore((state) => state.authStatus)
  const marketplaceRole = usePlanStore((state) => state.marketplaceRole)

  if (authStatus === 'unknown') return <div className="grid min-h-screen place-items-center bg-[#09090b] text-sm text-zinc-400">Checking access...</div>
  if (authStatus !== 'authenticated') return <Navigate to="/login?returnTo=/app/marketplace-admin" replace />
  if (!marketplaceRole) return <div className="grid min-h-screen place-items-center bg-[#09090b] px-6 text-zinc-100"><div className="max-w-md text-center"><h1 className="text-2xl font-semibold">Marketplace access required</h1><p className="mt-2 text-sm text-zinc-400">This workspace is available to MEJay marketplace staff.</p><Button className="mt-6" onClick={() => history.back()}>Go back</Button></div></div>
  return <Outlet />
}