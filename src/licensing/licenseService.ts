import {usePlanStore} from '@/stores/planStore'
import {useLicenseStore} from './licenseStore'

function applyGatingFromLicense(): void {
	const license = useLicenseStore.getState()

	// If the device has ever activated a license (token present), license becomes the source of truth.
	// Otherwise we leave the existing plan (e.g., Stripe runtime) alone.
	if (!license.token) return

	if (license.derivedStatus === 'PRO_OK') {
		usePlanStore.getState().setRuntimePlan(license.plan === 'full_program' ? 'full_program' : 'pro')
		return
	}

	// Mandatory check / invalid / expired => treat as Free until refreshed.
	usePlanStore.getState().setRuntimePlan('free')
}

export async function startupCheck(): Promise<void> {
	const store = useLicenseStore.getState()
	await store.recompute()

	const license = useLicenseStore.getState()
	if (license.token) {
		const online = typeof navigator === 'undefined' ? true : navigator.onLine !== false

		if (license.derivedStatus === 'PRO_NEEDS_MANDATORY_CHECK') {
			if (online) {
				try {
					await store.forceRefresh()
				} catch {
					// Keep needs-check state; gating will block pro.
				}
			}
		} else if (license.derivedStatus === 'PRO_OK') {
			// Best-effort background refresh (non-blocking).
			if (online) {
				void store.tryRefreshIfOnline()
			}
		}

		await store.recompute()
	}

	applyGatingFromLicense()
}

export function periodicPolicyTick(): void {
	const store = useLicenseStore.getState()
	void store.recompute().then(() => {
		applyGatingFromLicense()

		const license = useLicenseStore.getState()
		const online = typeof navigator === 'undefined' ? true : navigator.onLine !== false
		if (online && license.token && license.derivedStatus === 'PRO_NEEDS_MANDATORY_CHECK') {
			void store.tryRefreshIfOnline()
		}
	})
}

export async function handleBecameOnline(): Promise<void> {
	await startupCheck()
}

