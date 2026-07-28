// 26-schema.errors.ts — the line-aligned twin: tsgo's diagnostics here derive each expected code and position.
// @ts-nocheck
import { z } from 'zod'
const StopSchema = z.object({
  quay: z.string(),
  leagues: z.number(),
})
const ManifestSchema = z.object({
  ticket: z.string(),
  stops: StopSchema.array(),
})
const manifest = ManifestSchema.parse({ ticket: 'M-1', stops: [{ quay: 'Hull', leagues: 5 }] })
const wrongLeaf: number = manifest.stops[0].quay
type Stop = z.infer<typeof StopSchema>
const PostmarkSchema = z.object({
  sent: z.coerce.date(),
})
const postmark = PostmarkSchema.parse({ sent: '2026-07-28T09:00:00Z' })
const wrongStamp: string = postmark.sent

const wrongPromise: Promise<Stop> = Promise.resolve({ quay: 42, leagues: 5 })
const wrongList: Stop[] = [{ quay: 42, leagues: 5 }]
