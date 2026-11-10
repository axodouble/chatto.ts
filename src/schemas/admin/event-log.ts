import { z } from 'zod'

/** One durable EVT stream entry decoded for operator inspection. */
export const AdminEventLogEntrySchema = z.object({
  /** EVT stream sequence (uint64 kept as a string; use it as a cursor/ID). */
  sequence: z.string().default(''),
  /** NATS subject, e.g. `evt.user.U….privileged_mode_activated`. */
  subject: z.string().default(''),
  aggregateType: z.string().default(''),
  aggregateId: z.string().default(''),
  /** Event payload type (e.g. `MessagePostedEvent`), or `decode-error`. */
  eventType: z.string().default(''),
  eventId: z.string().default(''),
  actorId: z.string().default(''),
  createdAt: z.string().optional(),
  /** Pretty-printed, sanitized JSON of the event payload (`JSON.parse` it if needed). */
  payloadJson: z.string().default(''),
})
export type AdminEventLogEntry = z.infer<typeof AdminEventLogEntrySchema>

export const ListEventsResponseSchema = z.object({
  entries: z.array(AdminEventLogEntrySchema).default([]),
  /** Whether older rows may be fetched with `endCursor`. */
  hasOlder: z.boolean().default(false),
  /** Pass as `before` to load older rows. */
  endCursor: z.string().optional(),
  /** Total EVT message count reported by JetStream. */
  totalCount: z.coerce.number().default(0),
  /** Stream sequences inspected for this page. */
  scannedCount: z.number().default(0),
  /** Maximum sequences inspected for this page. */
  scanLimit: z.number().default(0),
  /** A filtered request hit `scanLimit` before filling a page; continue with `endCursor`. */
  scanLimited: z.boolean().default(false),
})
export type AdminEventLogPage = z.infer<typeof ListEventsResponseSchema>

export const ListEventTypesResponseSchema = z.object({ eventTypes: z.array(z.string()).default([]) })
export const GetEventResponseSchema = z.object({ entry: AdminEventLogEntrySchema })
