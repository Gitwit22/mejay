import {z} from 'zod'

export const reportingDateSchema = z.string().date()
export const reportingBatchSchema = z.object({reportDate: reportingDateSchema}).strict()
export const reportingBatchResolutionSchema = z.object({
  status: z.enum(['accepted', 'rejected']),
  reason: z.string().trim().min(1).max(1000).optional(),
}).strict().superRefine((value, context) => {
  if (value.status === 'rejected' && !value.reason) {
    context.addIssue({code: z.ZodIssueCode.custom, path: ['reason'], message: 'A rejection reason is required'})
  }
})

export const reportingCorrectionSchema = z.object({
  correctionType: z.enum(['void', 'replace']),
  reason: z.string().trim().min(1).max(1000),
  replacementData: z.object({
    isrc: z.string().trim().toUpperCase().regex(/^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$/).nullable().optional(),
    upc: z.string().trim().regex(/^[0-9]{12,14}$/).nullable().optional(),
    artistName: z.string().trim().min(1).max(300).optional(),
    releaseTitle: z.string().trim().min(1).max(300).optional(),
    trackTitle: z.string().trim().min(1).max(300).optional(),
    stripeTransactionId: z.string().trim().min(1).max(128).optional(),
    currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).optional(),
    priceMinor: z.number().int().nonnegative().optional(),
    quantity: z.number().int().positive().optional(),
    territory: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).nullable().optional(),
  }).strict().refine((value) => Object.keys(value).length > 0, 'At least one replacement field is required').optional(),
}).strict().superRefine((value, context) => {
  if (value.correctionType === 'replace' && !value.replacementData) {
    context.addIssue({code: z.ZodIssueCode.custom, path: ['replacementData'], message: 'Replacement data is required'})
  }
  if (value.correctionType === 'void' && value.replacementData) {
    context.addIssue({code: z.ZodIssueCode.custom, path: ['replacementData'], message: 'Void corrections cannot include replacement data'})
  }
})
