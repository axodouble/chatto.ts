import type { z } from 'zod'
import type {
  MessageSchema,
  MessageReactionSchema,
  CreateMessageInputSchema,
  UpdateMessageInputSchema,
} from './schemas/message'
import type {
  AssetSchema,
  MessageAttachmentSchema,
  AssetUploadSchema,
  MessageVideoProcessingSchema,
} from './schemas/asset'
import type { RoomSchema } from './schemas/room'
import type { MessageDeleteEventSchema, ReactionEventSchema } from './schemas/realtime'
import type { UserSchema, DirectoryMemberSchema } from './schemas/user'
import { Message } from './resources/message'
import type { SessionTokens } from './auth/token-store'
import type { RealtimeEventMeta, RealtimeEventName } from './realtime/events'
import type {
  RealtimeCaughtUp,
  RealtimeEvent,
  RealtimeEventPayloads,
  RealtimeSnapshot,
} from './realtime/generated'

export type MessageData = z.infer<typeof MessageSchema>
export type MessageReaction = z.infer<typeof MessageReactionSchema>
export type CreateMessageInput = z.infer<typeof CreateMessageInputSchema>
export type UpdateMessageInput = z.infer<typeof UpdateMessageInputSchema>
export type RoomData = z.infer<typeof RoomSchema>
export type MessageDeleteEvent = z.infer<typeof MessageDeleteEventSchema>
export type ReactionEvent = z.infer<typeof ReactionEventSchema>
export type UserData = z.infer<typeof UserSchema>
export type DirectoryMemberData = z.infer<typeof DirectoryMemberSchema>
export type AssetData = z.infer<typeof AssetSchema>
export type MessageAttachmentData = z.infer<typeof MessageAttachmentSchema>
export type AssetUploadData = z.infer<typeof AssetUploadSchema>
export type VideoProcessingData = z.infer<typeof MessageVideoProcessingSchema>

/** A file to upload: raw bytes plus metadata. */
export interface FileInput {
  data: Uint8Array | ArrayBuffer
  filename: string
  /** MIME type; defaults to `application/octet-stream` when omitted. */
  contentType?: string
}

/** Thumbnail transform options for asset reads. */
export interface ThumbnailOptions {
  width: number
  height: number
  fit?: 'contain' | 'cover'
}

export interface ReconnectOptions {
  /** First reconnect delay, in ms. Default 1000. */
  baseDelayMs?: number
  /** Maximum reconnect delay, in ms. Default 30000. */
  maxDelayMs?: number
  /** Backoff multiplier per attempt. Default 2. */
  factor?: number
  /** Max reconnect attempts before giving up. Default Infinity. */
  maxAttempts?: number
}

/** @deprecated Only used by password sessions, which are unsupported. */
export interface RefreshOptions {
  /** Optional opt-in periodic re-login interval, in ms. Default: disabled. */
  intervalMs?: number
}

/** Friendly presence status accepted by client.setStatus(). */
export type PresenceInput = 'online' | 'away' | 'dnd' | 'offline' | 'idle' | 'invisible'

/** Input for client.setCustomStatus(). */
export interface CustomStatusInput {
  emoji: string
  text: string
  /** Optional future expiry; a Date is serialized to an ISO string. */
  expiresAt?: Date | string
}

/** Custom status as stored/returned by the server. */
export interface CustomStatus {
  emoji: string
  text: string
  expiresAt?: string
}

/** Presence liveness behavior. */
export interface PresenceOptions {
  /**
   * Send a RefreshPresence heartbeat while connected and after setStatus, so
   * the account appears with its saved choice (Online when none is saved).
   * Disable for clients that should never show the account as online. Default true.
   */
  autoRefresh?: boolean
  /** Heartbeat interval in ms. Default 30000. */
  intervalMs?: number
}

/** Realtime subscription behavior. */
export interface RealtimeOptions {
  /**
   * What to receive when the client cannot resume from its last cursor
   * (first connect, or a reconnect after the 15-minute cursor lifetime):
   * - `'live'` (default): start at the current boundary; no initial state.
   * - `'snapshot'`: first receive a `snapshot` event with the server profile,
   *   visible rooms and room groups, referenced users, and active calls.
   */
  initialState?: 'live' | 'snapshot'
  /** Reconnect when no frame (heartbeat or event) arrives for this long. Default 75000 ms. */
  heartbeatTimeoutMs?: number
}

export interface ChattoClientOptions {
  baseUrl: string
  /** Bot API key (`cht_BK_…`), sent as `Authorization: Bearer <token>`. Keys never expire. */
  token: string
  /**
   * Rotating refresh token from a password login; enables silent renewal.
   * @deprecated Password authentication is unsupported. Use a bot API key as `token`.
   */
  refreshToken?: string
  /**
   * When `token` expires (Date or epoch ms); enables proactive renewal.
   * @deprecated Only password sessions expire. Password authentication is unsupported. Use a bot API key as `token`.
   */
  tokenExpiresAt?: Date | number
  /**
   * Retained password credentials; enables automatic re-login on auth failure.
   * @deprecated Password authentication is unsupported. Use a bot API key as `token`.
   */
  credentials?: { login: string; password: string }
  reconnect?: ReconnectOptions
  /** @deprecated Only used by password sessions. Password authentication is unsupported. Use a bot API key as `token`. */
  refresh?: RefreshOptions
  presence?: PresenceOptions
  realtime?: RealtimeOptions
}

/**
 * One entry per realtime event variant: `client.on('roomCreated', (payload, meta) => ...)`.
 * Payload types are generated from Chatto's `chatto.realtime.v1` protos.
 */
export type RealtimeEventMap = {
  [K in RealtimeEventName]: [payload: RealtimeEventPayloads[K], meta: RealtimeEventMeta]
}

export interface ClientEventMap extends RealtimeEventMap {
  ready: []
  messageCreate: [message: Message]
  messageUpdate: [message: Message]
  messageDelete: [event: MessageDeleteEvent]
  reactionAdd: [event: ReactionEvent]
  reactionRemove: [event: ReactionEvent]
  error: [err: Error]
  disconnect: []
  /**
   * Emitted after the session was renewed. Persist `session.refreshToken`:
   * refresh tokens rotate and the previous one is no longer valid.
   * @deprecated Only fires for password sessions, which are unsupported.
   */
  tokenRefresh: [session: SessionTokens]
  /** Emitted before each reconnect attempt. */
  reconnecting: [attempt: number, delayMs: number]
  /** Every decoded realtime event, before the typed and convenience events. */
  raw: [event: RealtimeEvent]
  /** Initial state, when `realtime.initialState` is `'snapshot'` and the stream was not resumed. */
  snapshot: [snapshot: RealtimeSnapshot]
  /**
   * The stream reached live delivery. `recovery` is `REALTIME_RECOVERY_RESUMED`
   * when no events were missed across a reconnect; `SNAPSHOT`/`LIVE_ONLY` means
   * events during the outage may be missing — refetch state you depend on.
   */
  caughtUp: [state: RealtimeCaughtUp]
}