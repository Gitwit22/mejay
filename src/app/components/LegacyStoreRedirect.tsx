import {Navigate, useLocation} from 'react-router-dom'

/** The standalone Marketplace listing was merged into Discover; keep old `/app/store` links (and their artist filter) working. */
export default function LegacyStoreRedirect() {
  const location = useLocation()
  const params = new URLSearchParams(location.search)
  params.set('tab', 'music')
  return <Navigate to={`/app?${params.toString()}`} replace />
}
