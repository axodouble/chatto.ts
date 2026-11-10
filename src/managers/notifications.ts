import type { ClientContext } from '../context'
import { ChattoValidationError } from '../errors'
import { type Page, type PageOptions, pageRequest, toPage } from '../util/page'
import {
  ListNotificationOccurrencesResponseSchema,
  NotificationOccurrenceResponseSchema,
  BatchGetNotificationOccurrencesResponseSchema,
  DeleteNotificationOccurrenceResponseSchema,
  DeletedCountResponseSchema,
  NotificationPolicyResponseSchema,
  BatchGetNotificationPoliciesResponseSchema,
  NOTIFICATION_SIGNAL_CLASSES,
  type NotificationDeliveryMode,
  type NotificationOccurrence,
  type NotificationPolicyScope,
  type NotificationRoomUnreadCount,
  type NotificationSignalClass,
  type ScopedNotificationPolicy,
} from '../schemas/notification'

const SERVICE = 'chatto.api.v1.NotificationService'
const POLICY_SERVICE = 'chatto.api.v1.NotificationPolicyService'

/** One page of notification occurrences plus authoritative unread counters. */
export interface NotificationList extends Page<NotificationOccurrence> {
  /** Total unread occurrences (all pages). */
  unreadCount: number
  /** Unread occurrences with Important attention (all pages). */
  importantUnreadCount: number
  /** Earliest expiry in the whole list; re-read notifications at this time. */
  nextExpiryAt?: string
  /** Complete unread counts per target room, independent of the page. */
  roomUnreadCounts: NotificationRoomUnreadCount[]
}

/**
 * Policy scope input: `'server'` for the viewer's server-wide policy,
 * `{ roomGroupId }`, `{ roomId }` (DMs use room scope), or a parsed
 * {@link NotificationPolicyScope}.
 */
export type NotificationPolicyScopeInput =
  | 'server'
  | { roomId: string }
  | { roomGroupId: string }
  | NotificationPolicyScope

/**
 * Delivery-mode input. Friendly names or raw proto names (including the
 * deprecated `SILENT` / `ALERT` aliases) are accepted.
 */
export type NotificationDeliveryModeInput =
  | 'off' | 'in_app' | 'push' | 'unread_badge'
  | Exclude<NotificationDeliveryMode, 'NOTIFICATION_DELIVERY_MODE_UNSPECIFIED'>
  | 'NOTIFICATION_DELIVERY_MODE_SILENT' | 'NOTIFICATION_DELIVERY_MODE_ALERT'

/**
 * Sparse override changes: a mode sets the override, `null` clears it back to
 * "inherit". Signal classes that are not present are left untouched.
 */
export type NotificationPolicyChanges = Partial<Record<NotificationSignalClass, NotificationDeliveryModeInput | null>>

const MODE_INPUT: Record<string, string> = {
  off: 'NOTIFICATION_DELIVERY_MODE_OFF',
  in_app: 'NOTIFICATION_DELIVERY_MODE_IN_APP_NOTIFICATION',
  push: 'NOTIFICATION_DELIVERY_MODE_PUSH_NOTIFICATION',
  unread_badge: 'NOTIFICATION_DELIVERY_MODE_UNREAD_BADGE',
  NOTIFICATION_DELIVERY_MODE_SILENT: 'NOTIFICATION_DELIVERY_MODE_IN_APP_NOTIFICATION',
  NOTIFICATION_DELIVERY_MODE_ALERT: 'NOTIFICATION_DELIVERY_MODE_PUSH_NOTIFICATION',
}

function scopeInput(scope: NotificationPolicyScopeInput): Record<string, unknown> {
  if (scope === 'server') return { server: {} }
  if ('kind' in scope) {
    if (scope.kind === 'room') return { roomId: scope.roomId }
    if (scope.kind === 'roomGroup') return { roomGroupId: scope.roomGroupId }
    return { server: {} }
  }
  if ('roomId' in scope) return { roomId: scope.roomId }
  return { roomGroupId: scope.roomGroupId }
}

function checkIds(ids: readonly unknown[], what: string): void {
  if (ids.length > 100) {
    throw new ChattoValidationError('too_many_ids', `At most 100 ${what} may be given at once`)
  }
}

/**
 * The viewer's notifications (`chatto.api.v1.NotificationService`) and
 * notification delivery policies (`chatto.api.v1.NotificationPolicyService`).
 *
 * Realtime: `notificationOccurrencesChanged` means the occurrence list changed
 * (re-read with `list()`; `createdNotificationId` can be passed to `fetch()`),
 * and `notificationUnreadStateChanged` means unread counts changed (re-read
 * `list()` counters and the affected room).
 */
export class NotificationManager {
  constructor(private readonly ctx: ClientContext) {}

  /**
   * List notification occurrences, newest first (offset-paginated; page size
   * max 100, default 50). Also returns authoritative unread counters.
   */
  async list(opts: PageOptions = {}): Promise<NotificationList> {
    if (opts.limit != null && opts.limit > 100) {
      throw new ChattoValidationError('page_limit_too_large', 'At most 100 notifications may be listed per page')
    }
    const res = await this.ctx.rest.post(
      SERVICE,
      'ListNotificationOccurrences',
      { page: pageRequest(opts) },
      ListNotificationOccurrencesResponseSchema,
    )
    return {
      ...toPage(res.occurrences, res.page),
      unreadCount: res.unreadCount,
      importantUnreadCount: res.importantUnreadCount,
      nextExpiryAt: res.nextExpiryAt,
      roomUnreadCounts: res.roomUnreadCounts,
    }
  }

  /** Fetch one occurrence. NOT_FOUND when absent, deleted, expired, or no longer visible. */
  async fetch(notificationId: string): Promise<NotificationOccurrence> {
    const res = await this.ctx.rest.post(
      SERVICE,
      'GetNotificationOccurrence',
      { notificationId },
      NotificationOccurrenceResponseSchema,
    )
    return res.occurrence
  }

  /** Fetch up to 100 occurrences. Unknown/deleted/invisible IDs are omitted; duplicates de-duplicated. */
  async fetchMany(notificationIds: string[]): Promise<NotificationOccurrence[]> {
    if (notificationIds.length === 0) return []
    checkIds(notificationIds, 'notification IDs')
    const res = await this.ctx.rest.post(
      SERVICE,
      'BatchGetNotificationOccurrences',
      { notificationIds },
      BatchGetNotificationOccurrencesResponseSchema,
    )
    return res.occurrences
  }

  /** Mark one occurrence read (idempotent). Returns the updated occurrence. */
  async markRead(notificationId: string): Promise<NotificationOccurrence> {
    const res = await this.ctx.rest.post(
      SERVICE,
      'MarkNotificationRead',
      { notificationId },
      NotificationOccurrenceResponseSchema,
    )
    return res.occurrence
  }

  /** Permanently delete one occurrence (idempotent). `false` when it was already gone. */
  async delete(notificationId: string): Promise<boolean> {
    const res = await this.ctx.rest.post(
      SERVICE,
      'DeleteNotificationOccurrence',
      { notificationId },
      DeleteNotificationOccurrenceResponseSchema,
    )
    return res.deleted
  }

  /** Permanently delete up to 100 occurrences. Returns how many visible ones were deleted. */
  async deleteMany(notificationIds: string[]): Promise<number> {
    if (notificationIds.length === 0) return 0
    checkIds(notificationIds, 'notification IDs')
    const res = await this.ctx.rest.post(
      SERVICE,
      'BatchDeleteNotificationOccurrences',
      { notificationIds },
      DeletedCountResponseSchema,
    )
    return res.deletedCount
  }

  /**
   * Permanently delete every currently visible occurrence. Returns the number
   * deleted. Do not retry automatically: later activity may arrive in between.
   */
  async deleteAll(): Promise<number> {
    const res = await this.ctx.rest.post(SERVICE, 'DeleteAllNotificationOccurrences', {}, DeletedCountResponseSchema)
    return res.deletedCount
  }

  /**
   * Fetch the explicit (`overrides`) and effective delivery modes for one
   * scope. Room scope requires membership or a pending invitation.
   */
  async fetchPolicy(scope: NotificationPolicyScopeInput): Promise<ScopedNotificationPolicy> {
    const res = await this.ctx.rest.post(
      POLICY_SERVICE,
      'GetNotificationPolicy',
      { scope: scopeInput(scope) },
      NotificationPolicyResponseSchema,
    )
    return res.policy
  }

  /** Fetch up to 100 policies. Missing/inaccessible scopes are omitted. */
  async fetchPolicies(scopes: NotificationPolicyScopeInput[]): Promise<ScopedNotificationPolicy[]> {
    if (scopes.length === 0) return []
    checkIds(scopes, 'policy scopes')
    const res = await this.ctx.rest.post(
      POLICY_SERVICE,
      'BatchGetNotificationPolicies',
      { scopes: scopes.map(scopeInput) },
      BatchGetNotificationPoliciesResponseSchema,
    )
    return res.policies
  }

  /**
   * Atomically set or clear delivery-mode overrides at one scope. Only the
   * signal classes present in `changes` are touched (sent as the field mask);
   * `null` resets a class to "inherit".
   *
   * ```ts
   * await client.notifications.updatePolicy({ roomId }, { roomMessages: 'push', reactions: null })
   * ```
   */
  async updatePolicy(
    scope: NotificationPolicyScopeInput,
    changes: NotificationPolicyChanges,
  ): Promise<ScopedNotificationPolicy> {
    const mask: string[] = []
    const overrides: Record<string, string> = {}
    for (const key of NOTIFICATION_SIGNAL_CLASSES) {
      const value = changes[key]
      if (value === undefined) continue
      mask.push(key)
      if (value !== null) overrides[key] = MODE_INPUT[value] ?? value
    }
    if (mask.length === 0) {
      throw new ChattoValidationError('empty_update', 'At least one notification signal class must be changed')
    }
    const res = await this.ctx.rest.post(
      POLICY_SERVICE,
      'UpdateNotificationPolicy',
      { scope: scopeInput(scope), overrides, updateMask: mask.join(',') },
      NotificationPolicyResponseSchema,
    )
    return res.policy
  }
}
