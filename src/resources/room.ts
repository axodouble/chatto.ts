import type { RoomData, ThumbnailOptions } from '../types'
import type { ClientContext } from '../context'
import type { Message } from './message'
import type { User } from './user'
import type { MessagePayload } from '../builders/payload'
import type { Page, PageOptions } from '../util/page'
import type { RoomViewerState, RoomWithViewerState, RoomTimelinePage } from '../schemas/room'
import type { RoomNotice, RoomReadState, MarkRoomAsReadResult, RoomSuspension } from '../schemas/room-service'
import type { RoomInvitation } from '../schemas/room-invitation'
import { MessageManager } from '../managers/messages'
import {
  RoomManager,
  type FetchEventsOptions,
  type ListMembersOptions,
  type PinnedMessagesPage,
  type PublishNoticeOptions,
  type RemoveUserOptions,
  type RoomAttachment,
  type UpdateRoomInput,
} from '../managers/rooms'

/** Viewer-specific data that accompanies a room in directory responses. */
export interface RoomViewerExtras {
  viewerState?: RoomViewerState
  memberUserIds?: string[]
  hasMessageHistory?: boolean
  lastMessageAt?: string
  lastRootMessageAt?: string
}

export class Room {
  readonly id: string
  readonly name: string
  readonly description: string | undefined
  readonly kind: string
  readonly archived: boolean
  /** Room group ID (channels only). */
  readonly groupId: string | undefined
  /** True when every eligible server member is an effective member. */
  readonly universal: boolean
  /** Minimum seconds between root posts per member; 0 = slow mode off. */
  readonly slowModeSeconds: number
  readonly threadingMode: string
  /** Per-user interval within each thread; undefined on older servers. */
  readonly threadSlowModeSeconds: number | undefined
  readonly createdAt: string | undefined
  /** Whether clients should show join/leave activity (absent means true). */
  readonly showMembershipEvents: boolean
  /** Viewer state and permissions; present on rooms from `rooms.fetch`/`list`/`fetchMany`. */
  readonly viewerState: RoomViewerState | undefined
  /** All DM participant IDs (including deleted users). Empty for channels or when unknown. */
  readonly memberUserIds: string[]
  readonly hasMessageHistory: boolean | undefined
  readonly lastMessageAt: string | undefined
  readonly lastRootMessageAt: string | undefined

  constructor(data: RoomData, private readonly ctx: ClientContext, extras: RoomViewerExtras = {}) {
    this.id = data.id
    this.name = data.name
    this.description = data.description
    this.kind = data.kind
    this.archived = data.archived
    this.groupId = data.groupId || undefined
    this.universal = data.universal ?? false
    this.slowModeSeconds = data.slowModeSeconds ?? 0
    this.threadingMode = data.threadingMode ?? 'ROOM_THREADING_MODE_UNSPECIFIED'
    this.threadSlowModeSeconds = data.threadSlowModeSeconds
    this.createdAt = data.createdAt
    this.showMembershipEvents = data.showMembershipEvents ?? true
    this.viewerState = extras.viewerState
    this.memberUserIds = extras.memberUserIds ?? []
    this.hasMessageHistory = extras.hasMessageHistory
    this.lastMessageAt = extras.lastMessageAt
    this.lastRootMessageAt = extras.lastRootMessageAt
  }

  static partial(id: string, ctx: ClientContext): Room {
    return new Room(
      {
        id,
        name: id,
        kind: 'ROOM_KIND_UNSPECIFIED',
        archived: false,
        universal: false,
        slowModeSeconds: 0,
        threadingMode: 'ROOM_THREADING_MODE_UNSPECIFIED',
      },
      ctx,
    )
  }

  /** Build a Room from a directory `RoomWithViewerState` row. */
  static fromViewerState(data: RoomWithViewerState, ctx: ClientContext): Room {
    const { room, ...extras } = data
    return new Room(room, ctx, extras)
  }

  get isDM(): boolean {
    return this.kind === 'ROOM_KIND_DM'
  }

  get isChannel(): boolean {
    return this.kind === 'ROOM_KIND_CHANNEL'
  }

  /** Whether the viewer is a member; undefined when viewer state is unknown. */
  get isMember(): boolean | undefined {
    return this.viewerState?.isMember
  }

  /** Whether the viewer holds a room-scoped permission (e.g. `message.post`); undefined when unknown. */
  can(permission: string): boolean | undefined {
    if (this.viewerState == null) return undefined
    return this.viewerState.permissions.some(p => p.permission === permission && p.granted)
  }

  private get api(): RoomManager {
    return new RoomManager(this.ctx)
  }

  /** Send a message to this room. See `MessageManager.send`. */
  async send(payload: MessagePayload): Promise<Message> {
    return new MessageManager(this.ctx).send(this.id, payload)
  }

  // --- Timeline ---------------------------------------------------------------

  /** Messages from one timeline page (non-message events are skipped). */
  async fetchHistory(opts: FetchEventsOptions = {}): Promise<Message[]> {
    return this.hydrate(await this.api.fetchEvents(this.id, opts))
  }

  /** Messages from a timeline window centred on `eventId`. */
  async fetchHistoryAround(eventId: string, opts: { limit?: number } = {}): Promise<Message[]> {
    return this.hydrate(await this.api.fetchEventsAround(this.id, eventId, opts))
  }

  /** One raw timeline page including joins/leaves, calls and room changes. */
  fetchEvents(opts: FetchEventsOptions = {}): Promise<RoomTimelinePage> {
    return this.api.fetchEvents(this.id, opts)
  }

  /** A raw timeline window centred on `eventId`, with the anchor's `targetIndex`. */
  fetchEventsAround(eventId: string, opts: { limit?: number } = {}): Promise<RoomTimelinePage & { targetIndex: number }> {
    return this.api.fetchEventsAround(this.id, eventId, opts)
  }

  private hydrate(page: RoomTimelinePage): Promise<Message[]> {
    return Promise.all(
      page.events
        .filter(e => e.messagePosted != null)
        .map(e => this.ctx.hydrateMessage(e.messagePosted!.message)),
    )
  }

  // --- Lifecycle & membership -----------------------------------------------

  /** Updates editable metadata; see {@link UpdateRoomInput}. */
  update(input: UpdateRoomInput): Promise<Room> {
    return this.api.update(this.id, input)
  }

  archive(): Promise<Room> {
    return this.api.archive(this.id)
  }

  unarchive(): Promise<Room> {
    return this.api.unarchive(this.id)
  }

  join(): Promise<Room> {
    return this.api.join(this.id)
  }

  leave(): Promise<void> {
    return this.api.leave(this.id)
  }

  /** Invites a user (requires membership and `room.invite`). */
  invite(userId: string): Promise<RoomInvitation> {
    return this.api.invitations.create(this.id, userId)
  }

  listMembers(opts: ListMembersOptions = {}): Promise<Page<string>> {
    return this.api.listMembers(this.id, opts)
  }

  fetchMember(userId: string): Promise<User> {
    return this.api.fetchMember(this.id, userId)
  }

  fetchMembers(userIds: string[]): Promise<User[]> {
    return this.api.fetchMembers(this.id, userIds)
  }

  addMember(userId: string): Promise<User> {
    return this.api.addMember(this.id, userId)
  }

  removeMember(userId: string): Promise<boolean> {
    return this.api.removeMember(this.id, userId)
  }

  // --- Moderation ---------------------------------------------------------------

  /** Moderated removal with optional suspension (replaces ban). */
  removeUser(userId: string, opts: RemoveUserOptions): Promise<void> {
    return this.api.removeUser(this.id, userId, opts)
  }

  liftSuspension(userId: string, reason: string): Promise<void> {
    return this.api.liftSuspension(this.id, userId, reason)
  }

  listSuspensions(opts: PageOptions = {}): Promise<Page<RoomSuspension>> {
    return this.api.listSuspensions({ ...opts, roomId: this.id })
  }

  // --- Notice, read state, pins, typing, attachments ----------------------------

  fetchNotice(): Promise<RoomNotice> {
    return this.api.fetchNotice(this.id)
  }

  publishNotice(body: string, opts: PublishNoticeOptions = {}): Promise<RoomNotice> {
    return this.api.publishNotice(this.id, body, opts)
  }

  clearNotice(opts: { expectedVersion?: string } = {}): Promise<RoomNotice> {
    return this.api.clearNotice(this.id, opts)
  }

  fetchReadState(): Promise<RoomReadState> {
    return this.api.fetchReadState(this.id)
  }

  markAsRead(upToEventId?: string): Promise<MarkRoomAsReadResult> {
    return this.api.markAsRead(this.id, upToEventId)
  }

  listPins(opts: PageOptions = {}): Promise<PinnedMessagesPage> {
    return this.api.listPins(this.id, opts)
  }

  pin(messageEventId: string): Promise<Message> {
    return this.api.pin(this.id, messageEventId)
  }

  unpin(messageEventId: string): Promise<boolean> {
    return this.api.unpin(this.id, messageEventId)
  }

  /** Refreshes the typing indicator (call at most every 2 s while typing). */
  sendTyping(threadRootEventId?: string): Promise<void> {
    return this.api.sendTyping(this.id, threadRootEventId)
  }

  listAttachments(opts: PageOptions & { thumbnail?: ThumbnailOptions } = {}): Promise<Page<RoomAttachment>> {
    return this.api.listAttachments(this.id, opts)
  }
}
