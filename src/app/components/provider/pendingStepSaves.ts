import {createContext, useContext, useEffect, useRef} from 'react'

/** Saves a form's unsaved edits. Throws (with a message for the artist) if the edits cannot be saved. */
export type PendingSave = () => Promise<void>
export type PendingSaveRegistry = Map<string, PendingSave>

const PendingSavesContext = createContext<PendingSaveRegistry | null>(null)

export const PendingSavesProvider = PendingSavesContext.Provider

/**
 * Lets the wizard's "Save and continue" save what is on screen. A form with its own Save button
 * registers that save while it has unsaved changes; without this, continuing silently dropped them.
 */
export function usePendingSave(key: string, pending: boolean, save: PendingSave): void {
  const registry = useContext(PendingSavesContext)
  const latest = useRef(save)
  latest.current = save
  useEffect(() => {
    if (!registry || !pending) return
    registry.set(key, () => latest.current())
    return () => {registry.delete(key)}
  }, [registry, key, pending])
}

/** Runs every registered save in order and stops at the first failure so nothing is skipped silently. */
export async function flushPendingSaves(registry: PendingSaveRegistry): Promise<void> {
  for (const save of [...registry.values()]) await save()
}
