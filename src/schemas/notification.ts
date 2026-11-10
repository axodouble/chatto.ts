import { z } from 'zod'

import { PageInfoSchema } from './page'
import { UserSchema } from './user'
import { RoomSummarySchema } from './voice'

/**
 * Canonical delivery-mode names. The proto declares deprecated aliases with
 * the same numbers (`SILENT` = `IN_APP_NOTIFICATION`, `ALERT` =
 * `PUSH_NOTIFICATION`), and Chatto 0.5's JSON encoder actually emits the
 * deprecated names. Parsed values are normalized to these canonical names.
 */
export const NOTIFICATION_DELIVERY_MODES = [
  'NOTIFICATION_DELIVERY_MODE_UNSPECIFIED',
  'NOTIFICATION_DELIVERY_MODE_OFF',
  'NOTIFICATION_DELIVERY_MODE_IN_APP_NOTIFICATION',
  'NOTIFICATION_DELIVERY_MODE_PUSH_NOTIFICATION',
  'NOTIFICATION_DELIVERY_MODE_UNREAD_BADGE',
] as const

export type NotificationDeliveryMode = (typeof NOTIFICATION_DELIVERY_MODES)[number]

const DELIVERY_MODE_ALIASES: Record<string, NotificationDeliveryMode> = {
  NOTIFICATION_DELIVERY_MODE_SILENT: 'NOTIFICATION_DELIVERY_MODE_IN_APP_NOTIFICATION',
  NOTIFICATION_DELIVERY_MODE_ALERT: 'NOTIFICATION_DELIVERY_MODE_PUSH_NOTIFICATION',
}

/** Delivery mode; accepts canonical and deprecated alias names, outputs canonical names. */
export const NotificationDeliveryModeSchema = z
  .enum([...NOTIFICATION_DELIVERY_MODES, 'NOTIFICATION_DELIVERY_MODE_SILENT', 'NOTIFICATION_DELIVERY_MODE_ALERT'])
  .catch('NOTIFICATION_DELIVERY_MODE_UNSPECIFIED')
  .transform((v): NotificationDeliveryMode => DELIVERY_MODE_ALIASES[v] ?? (v as NotificationDeliveryMode))

/** Policy signal classes, in proto field order. */
export const NOTIFICATION_SIGNAL_CLASSES = [
  'directMessages',
  'directMentions',
  'replies',
  'roleMentions',
  'hereMentions',
  'allMentions',
  'followedThreads',
  /** @deprecated compatibility slot; use `roomMessages` at room scope. */
  'followedRooms',
  'reactions',
  'roomMessages',
  'roomInvitations',
] as const

export type NotificationSignalClass = (typeof NOTIFICATION_SIGNAL_CLASSES)[number]

/** Delivery modes per signal class. An absent field means "inherit". */
export const NotificationDeliveryModesSchema = z.object({
  directMessages: NotificationDeliveryModeSchema.optional(),
  directMentions: NotificationDeliveryModeSchema.optional(),
  replies: NotificationDeliveryModeSchema.optional(),
  roleMentions: NotificationDeliveryModeSchema.optional(),
  hereMentions: NotificationDeliveryModeSchema.optional(),
  allMentions: NotificationDeliveryModeSchema.optional(),
  followedThreads: NotificationDeliveryModeSchema.optional(),
  /** @deprecated Chatto does not derive this signal; use `roomMessages`. */
  followedRooms: NotificationDeliveryModeSchema.optional(),
  reactions: NotificationDeliveryModeSchema.optional(),
  roomMessages: NotificationDeliveryModeSchema.optional(),
  roomInvitations: NotificationDeliveryModeSchema.optional(),
})

export const NotificationAttentionLevelSchema = z
  .enum([
    'NOTIFICATION_ATTENTION_LEVEL_UNSPECIFIED',
    'NOTIFICATION_ATTENTION_LEVEL_AMBIENT',
    'NOTIFICATION_ATTENTION_LEVEL_IMPORTANT',
  ])
  .catch('NOTIFICATION_ATTENTION_LEVEL_UNSPECIFIED')
  .default('NOTIFICATION_ATTENTION_LEVEL_UNSPECIFIED')

/** Exact visible message destination of a notification. */
export const NotificationMessageReferenceSchema = z.object({
  room: RoomSummarySchema.optional(),
  /** Exact source (or reacted-to) message event ID. */
  eventId: z.string().default(''),
  /** Thread root when the target is inside a thread. */
  threadRootEventId: z.string().optional(),
})

const MessageSignalSchema = z.object({ message: NotificationMessageReferenceSchema.optional() })

export const NOTIFICATION_SIGNAL_KINDS = [
  'directMessageReceived',
  'directMentionReceived',
  'replyReceived',
  'roleMentionReceived',
  'hereMentionReceived',
  'allMentionReceived',
  'followedThreadActivity',
  'followedRoomActivity',
  'reactionReceived',
  'roomMessageReceived',
  'roomInvitationReceived',
] as const

/** Signal kind name, or `'unknown'` for variants this SDK does not know. */
export type NotificationSignalKind = (typeof NOTIFICATION_SIGNAL_KINDS)[number] | 'unknown'

/**
 * Typed cause/destination of a notification (a proto oneof: exactly one
 * member is set). `kind` names the set member. Unknown future variants pass
 * through with `kind: 'unknown'`; treat them as generic dismissible rows.
 */
export const NotificationSignalSchema = z
  .looseObject({
    directMessageReceived: MessageSignalSchema.optional(),
    directMentionReceived: MessageSignalSchema.optional(),
    replyReceived: MessageSignalSchema.optional(),
    roleMentionReceived: MessageSignalSchema.extend({ roleNames: z.array(z.string()).default([]) }).optional(),
    hereMentionReceived: MessageSignalSchema.optional(),
    allMentionReceived: MessageSignalSchema.optional(),
    followedThreadActivity: MessageSignalSchema.optional(),
    /** @deprecated Chatto does not derive this signal. */
    followedRoomActivity: MessageSignalSchema.optional(),
    reactionReceived: MessageSignalSchema.extend({ emoji: z.string().default('') }).optional(),
    roomMessageReceived: MessageSignalSchema.optional(),
    roomInvitationReceived: z
      .object({ room: RoomSummarySchema.optional(), invitationId: z.string().default('') })
      .optional(),
  })
  .transform(s => ({
    ...s,
    kind: (NOTIFICATION_SIGNAL_KINDS.find(k => s[k] != null) ?? 'unknown') as NotificationSignalKind,
  }))

/** One exact notification occurrence. */
export const NotificationOccurrenceSchema = z.object({
  id: z.string(),
  createdAt: z.string().optional(),
  /** User who caused the activity, when still visible. */
  actor: UserSchema.optional(),
  signal: NotificationSignalSchema.prefault({}),
  /** Whether this occurrence still contributes unread attention. */
  unread: z.boolean().default(false),
  /** Absolute expiry (invitation deadline, otherwise 90 days after activity). */
  expiresAt: z.string().optional(),
  attentionLevel: NotificationAttentionLevelSchema,
})

export const NotificationRoomUnreadCountSchema = z.object({
  roomId: z.string(),
  unreadCount: z.number().int().default(0),
  importantUnreadCount: z.number().int().default(0),
})

export const ListNotificationOccurrencesResponseSchema = z.object({
  occurrences: z.array(NotificationOccurrenceSchema).default([]),
  page: PageInfoSchema.optional(),
  unreadCount: z.number().int().default(0),
  nextExpiryAt: z.string().optional(),
  roomUnreadCounts: z.array(NotificationRoomUnreadCountSchema).default([]),
  importantUnreadCount: z.number().int().default(0),
})
export const NotificationOccurrenceResponseSchema = z.object({ occurrence: NotificationOccurrenceSchema })
export const BatchGetNotificationOccurrencesResponseSchema = z.object({
  occurrences: z.array(NotificationOccurrenceSchema).default([]),
})
export const DeleteNotificationOccurrenceResponseSchema = z.object({ deleted: z.boolean().default(false) })
export const DeletedCountResponseSchema = z.object({ deletedCount: z.number().int().default(0) })

/** Policy scope, normalized from the proto oneof. */
export const NotificationPolicyScopeSchema = z
  .object({
    server: z.object({}).optional(),
    roomGroupId: z.string().optional(),
    roomId: z.string().optional(),
  })
  .transform((s): NotificationPolicyScope =>
    s.roomId != null ? { kind: 'room', roomId: s.roomId }
    : s.roomGroupId != null ? { kind: 'roomGroup', roomGroupId: s.roomGroupId }
    : { kind: 'server' },
  )

export type NotificationPolicyScope =
  | { kind: 'server' }
  | { kind: 'roomGroup'; roomGroupId: string }
  | { kind: 'room'; roomId: string }

export const ScopedNotificationPolicySchema = z.object({
  scope: NotificationPolicyScopeSchema.prefault({}),
  policy: z
    .object({
      /** Explicit modes at this scope. Missing fields mean "inherit". */
      overrides: NotificationDeliveryModesSchema.default({}),
      /** Complete modes after product, server, room-group and room inheritance. */
      effective: NotificationDeliveryModesSchema.default({}),
    })
    .prefault({}),
})

export const NotificationPolicyResponseSchema = z.object({ policy: ScopedNotificationPolicySchema })
export const BatchGetNotificationPoliciesResponseSchema = z.object({
  policies: z.array(ScopedNotificationPolicySchema).default([]),
})

export type NotificationDeliveryModes = z.infer<typeof NotificationDeliveryModesSchema>
export type NotificationAttentionLevel = z.infer<typeof NotificationAttentionLevelSchema>
export type NotificationMessageReference = z.infer<typeof NotificationMessageReferenceSchema>
export type NotificationSignal = z.infer<typeof NotificationSignalSchema>
export type NotificationOccurrence = z.infer<typeof NotificationOccurrenceSchema>
export type NotificationRoomUnreadCount = z.infer<typeof NotificationRoomUnreadCountSchema>
export type ScopedNotificationPolicy = z.infer<typeof ScopedNotificationPolicySchema>
