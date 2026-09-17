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
