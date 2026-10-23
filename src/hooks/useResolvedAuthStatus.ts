import {useEffect} from 'react'

import {usePlanStore} from '@/stores/planStore'

/** Pages outside the app shell resolve the session themselves so Buy and Back go to the right place. */
export function useResolvedAuthStatus() {
  const authStatus = usePlanStore((state) => state.authStatus)
  useEffect(() => {
    if (authStatus === 'unknown') void usePlanStore.getState().refreshFromServer({reason: 'appEntry'}).catch(() => undefined)
  }, [authStatus])
  return authStatus
}
