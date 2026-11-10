import type { ClientContext } from '../../context'
import {
  ListEventsResponseSchema,
  ListEventTypesResponseSchema,
  GetEventResponseSchema,
  type AdminEventLogEntry,
  type AdminEventLogPage,
} from '../../schemas/admin/event-log'

const SERVICE = 'chatto.admin.v1.AdminEventLogService'

export interface ListAdminEventsOptions {
  /** Max entries (server default 50, values above 200 are clamped to 200). */
  limit?: number
  /** Exclusive sequence cursor (a previous page's `endCursor`); returns older entries. */
  before?: string
  /** Event payload type, e.g. `'MessagePostedEvent'` (see `listEventTypes()`). */
  eventType?: string
  /** Actor user ID. */
  actorId?: string
  /** Inclusive lower creation-time bound. */
  from?: Date | string
  /** Inclusive upper creation-time bound. */
  to?: Date | string
}

const iso = (d?: Date | string) => (d == null ? undefined : typeof d === 'string' ? d : d.toISOString())

/**
 * Durable event-log (audit) inspection (`chatto.admin.v1.AdminEventLogService`).
 * Requires `admin.view-audit` (privileged mode for human sessions —
 * `client.viewer.activatePrivilegedMode()`).
 */
export class AdminEventLogManager {
  constructor(private readonly ctx: ClientContext) {}

  /**
   * List event-log entries newest first. Filtered scans inspect a bounded
   * window per request: when `scanLimited` is true, continue with
   * `before: page.endCursor` even if the page is short.
   */
  async list(opts: ListAdminEventsOptions = {}): Promise<AdminEventLogPage> {
    const filter =
      opts.eventType || opts.actorId || opts.from != null || opts.to != null
        ? {
            eventType: opts.eventType || undefined,
            actorId: opts.actorId || undefined,
            createdAtFrom: iso(opts.from),
            createdAtTo: iso(opts.to),
          }
        : undefined
    return this.ctx.rest.post(
      SERVICE,
      'ListEvents',
      { limit: opts.limit, before: opts.before || undefined, filter },
      ListEventsResponseSchema,
    )
  }

  /** Sorted event type names accepted by the `eventType` filter. */
  async listEventTypes(): Promise<string[]> {
    const res = await this.ctx.rest.post(SERVICE, 'ListEventTypes', {}, ListEventTypesResponseSchema)
    return res.eventTypes
  }

  /** Read one entry by EVT stream sequence. NOT_FOUND when it doesn't exist. */
  async fetch(sequence: string | number): Promise<AdminEventLogEntry> {
    const res = await this.ctx.rest.post(SERVICE, 'GetEvent', { sequence: String(sequence) }, GetEventResponseSchema)
    return res.entry
  }
}
