import {z} from 'zod'

const expectedVersion = z.number().int().positive()
const note = z.string().trim().min(1).max(4000)

export const releaseAdminCommandSchema = z.discriminatedUnion('action', [
  z.object({action: z.literal('start_review'), expectedVersion}),
  z.object({action: z.literal('approve'), expectedVersion}),
  z.object({action: z.literal('request_changes'), expectedVersion, note}),
  z.object({action: z.literal('reject'), expectedVersion, note}),
  z.object({action: z.literal('publish_now'), expectedVersion}),
  z.object({action: z.literal('schedule'), expectedVersion, scheduledReleaseAt: z.string().datetime({offset: true})}),
  z.object({action: z.literal('publish_due'), expectedVersion}),
  z.object({action: z.literal('unpublish'), expectedVersion}),
  z.object({action: z.literal('takedown'), expectedVersion, note}),
])

export type ReleaseAdminCommand = z.infer<typeof releaseAdminCommandSchema>

const orderedIds = z.array(z.string().trim().min(1)).max(20).refine((ids) => new Set(ids).size === ids.length, 'IDs must be unique')

export const discoveryFeaturesSchema = z.object({
  releaseIds: orderedIds,
  artistIds: orderedIds,
})

export type DiscoveryFeaturesInput = z.infer<typeof discoveryFeaturesSchema>