import type { ClientContext } from '../context'
import type { Message } from '../resources/message'
import type { ThumbnailOptions } from '../types'
import { Room } from '../resources/room'
import { User } from '../resources/user'
import { Attachment } from '../resources/attachment'
import { ChattoValidationError } from '../errors'
import { pageRequest, toPage, type Page, type PageOptions } from '../util/page'
import { RoomInvitationManager } from './room-invitations'
import {
  ListRoomsResponseSchema,
  GetRoomResponseSchema,
  BatchGetRoomsResponseSchema,
  ListRoomGroupsResponseSchema,
  GetRoomGroupResponseSchema,
  BatchGetRoomGroupsResponseSchema,
  GetRoomEventsResponseSchema,
  GetRoomEventsAroundResponseSchema,
  type RoomDirectoryScope,
  type RoomArchiveFilter,
  type RoomThreadingMode,
  type RoomGroup,
  type RoomTimelinePage,
} from '../schemas/room'
import {
  RoomMutationResponseSchema,
  JoinRoomGroupResponseSchema,
  EmptyResponseSchema,
  RoomNoticeResponseSchema,
  GetRoomReadStateResponseSchema,
  BatchGetRoomReadStatesResponseSchema,
  MarkRoomAsReadResponseSchema,
  ListMembersResponseSchema,
  MemberResponseSchema,
  BatchGetMembersResponseSchema,
  RemoveMemberResponseSchema,
  ListSuspensionsResponseSchema,
  ListRoomAttachmentsResponseSchema,
  ListPinnedMessagesResponseSchema,
  CreatePinnedMessageResponseSchema,
  DeletePinnedMessageResponseSchema,
  type RoomNotice,
  type RoomReadState,
  type MarkRoomAsReadResult,
  type RoomSuspension,
} from '../schemas/room-service'

const ROOMS = 'chatto.api.v1.RoomService'
const DIRECTORY = 'chatto.api.v1.RoomDirectoryService'

/** Max interval for `slowModeSeconds` / `threadSlowModeSeconds` (six hours). */
const MAX_SLOW_MODE_SECONDS = 21600

// --- Friendly enum inputs (raw proto enum names are always accepted too) ---

export type RoomScopeInput = 'all' | 'channels' | 'dms' | RoomDirectoryScope
export type RoomArchiveFilterInput = 'active' | 'archived' | 'all' | RoomArchiveFilter
export type ThreadingModeInput = 'required' | 'encouraged' | 'enabled' | 'disabled' | RoomThreadingMode
export type MemberPresenceInput =
  | 'online'
  | 'away'
  | 'dnd'
  | 'offline'
  | 'PRESENCE_STATUS_ONLINE'
  | 'PRESENCE_STATUS_AWAY'
  | 'PRESENCE_STATUS_DO_NOT_DISTURB'
  | 'PRESENCE_STATUS_OFFLINE'

function scopeInput(v?: RoomScopeInput): RoomDirectoryScope | undefined {
  if (v == null) return undefined
  if (v === 'all') return 'ROOM_DIRECTORY_SCOPE_ALL'
  if (v === 'channels') return 'ROOM_DIRECTORY_SCOPE_CHANNELS'
  if (v === 'dms') return 'ROOM_DIRECTORY_SCOPE_DMS'
  return v
}

function archiveInput(v?: RoomArchiveFilterInput): RoomArchiveFilter | undefined {
  if (v == null) return undefined
  if (v === 'active') return 'ROOM_ARCHIVE_FILTER_ACTIVE'
  if (v === 'archived') return 'ROOM_ARCHIVE_FILTER_ARCHIVED'
  if (v === 'all') return 'ROOM_ARCHIVE_FILTER_ALL'
  return v
}

function threadingInput(v?: ThreadingModeInput): RoomThreadingMode | undefined {
  if (v == null) return undefined
  if (v.startsWith('ROOM_THREADING_MODE_')) return v as RoomThreadingMode
  return `ROOM_THREADING_MODE_${v.toUpperCase()}` as RoomThreadingMode
}

function presenceInput(v: MemberPresenceInput): string {
  switch (v) {
    case 'online': return 'PRESENCE_STATUS_ONLINE'
    case 'away': return 'PRESENCE_STATUS_AWAY'
    case 'dnd': return 'PRESENCE_STATUS_DO_NOT_DISTURB'
    case 'offline': return 'PRESENCE_STATUS_OFFLINE'
    default: return v
  }
}

function thumbnailInput(thumbnail?: ThumbnailOptions) {
  if (thumbnail == null) return undefined
  const fit =
    thumbnail.fit === 'cover' ? 'IMAGE_FIT_MODE_COVER'
    : thumbnail.fit === 'contain' ? 'IMAGE_FIT_MODE_CONTAIN'
    : undefined
  return { width: thumbnail.width, height: thumbnail.height, fit }
}

function timestamp(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : v
}

function checkBatch(ids: string[], what: string): boolean {
  if (ids.length > 100) {
    throw new ChattoValidationError(`too_many_${what}_ids`, `At most 100 ${what} IDs may be fetched at once`)
  }
  return ids.length > 0
}

function checkSlowMode(field: string, v: number | null | undefined): void {
  if (v == null) return
  if (!Number.isInteger(v) || v < 0 || v > MAX_SLOW_MODE_SECONDS) {
    throw new ChattoValidationError('invalid_slow_mode', `${field} must be an integer between 0 and ${MAX_SLOW_MODE_SECONDS}`)
  }
}

function checkReason(reason: string): void {
  if (reason.length < 1 || reason.length > 1000) {
    throw new ChattoValidationError('invalid_reason', 'A moderation reason of 1–1000 characters is required')
  }
}

// --- Option / input types ---------------------------------------------------

export interface ListRoomsOptions extends PageOptions {
  /** Room kinds to include. Defaults to all (channels + the caller's DMs). */
  scope?: RoomScopeInput
  /** Archive state to include. Defaults to active rooms only. */
  archive?: RoomArchiveFilterInput
}

export interface CreateRoomInput {
  /** Visible 1–30-code-point name. */
  name: string
  /** Room group that should contain the new channel. */
  groupId: string
  /** Up to 500 characters. */
  description?: string
  /** Grant effective membership to every eligible server member. */
  universal?: boolean
  /** Defaults to `enabled`. */
  threadingMode?: ThreadingModeInput
}

/**
 * Editable room fields. Only keys present in the object are sent (and put into
 * the update mask). Pass `null` to reset a field to its server default.
 */
export interface UpdateRoomInput {
  name?: string | null
  /** Empty string or `null` clears the description. */
  description?: string | null
  universal?: boolean | null
  /** Root posting interval in seconds, 0–21600. 0 disables slow mode. Channels only. */
  slowModeSeconds?: number | null
  threadingMode?: ThreadingModeInput | null
  /** Per-user interval within each thread, 0–21600. */
  threadSlowModeSeconds?: number | null
  /** Show join/leave activity in the timeline. Requires `room.manage`. */
  showMembershipEvents?: boolean | null
}

const UPDATE_FIELDS = [
  'name',
  'description',
  'universal',
  'slowModeSeconds',
  'threadingMode',
  'threadSlowModeSeconds',
  'showMembershipEvents',
] as const

export interface FetchEventsOptions {
  /** Max events (server default 50, capped at 500). */
  limit?: number
  /** Page toward older events from a previous `startCursor`. */
  before?: string
  /** Page toward newer events from a previous `endCursor` (ignored when `before` is set). */
  after?: string
}

export interface ListMembersOptions extends PageOptions {
  /** Case-insensitive search against login and display name (max 100 chars). */
  search?: string
  /** Only members whose presence is one of these (max 4). */
  presence?: MemberPresenceInput[]
}

export interface RemoveUserOptions {
  /** Required moderator reason (1–1000 chars), stored for audit. */
  reason: string
  /** Suspend until this future time. Mutually exclusive with `suspendIndefinitely`. */
  suspendUntil?: Date | string
  /** Suspend until lifted. Universal rooms require a suspension. */
  suspendIndefinitely?: boolean
}

export interface ListSuspensionsOptions extends PageOptions {
  /** Only suspensions in this room. Defaults to all rooms. */
  roomId?: string
}

export interface PublishNoticeOptions {
  /** `version` of the notice being replaced; stale versions fail with ABORTED. */
  expectedVersion?: string
  /** Re-announce to members who dismissed the previous notice. */
  republish?: boolean
}

/** A room attachment row, with the attachment wrapped as an {@link Attachment}. */
export interface RoomAttachment {
  attachment: Attachment
  messageEventId: string
  threadRootEventId: string | undefined
  createdAt: string | undefined
  description: string | undefined
}

/** A page of pinned messages, newest pin first. */
export interface PinnedMessagesPage extends Page<Message> {
  /** Opaque marker for the latest pin; changes only when a new pin is added. */
  latestPinMarker: string
}

/**
 * Rooms: directory reads (`RoomDirectoryService`) and room-scoped operations
 * (`RoomService`). Invitations live under {@link RoomManager.invitations}.
 */
export class RoomManager {
  readonly invitations: RoomInvitationManager

  constructor(private readonly ctx: ClientContext) {
    this.invitations = new RoomInvitationManager(ctx)
  }

  // --- Directory ------------------------------------------------------------

  /**
   * Lists rooms visible to the current user. Without `limit`/`offset` every page
   * is followed and all rooms are returned; with them, one page is returned
   * (use {@link listPage} for paging metadata).
   */
  async list(opts: ListRoomsOptions = {}): Promise<Room[]> {
    if (opts.limit != null || opts.offset != null) return (await this.listPage(opts)).items
    const rooms: Room[] = []
    for (;;) {
      const page = await this.listPage({ ...opts, offset: rooms.length === 0 ? undefined : rooms.length })
      rooms.push(...page.items)
      if (!page.hasMore || page.items.length === 0) return rooms
    }
  }

  /** Lists one page of visible rooms, ordered by ID. Default 50, max 100 per page. */
  async listPage(opts: ListRoomsOptions = {}): Promise<Page<Room>> {
    const body: Record<string, unknown> = {}
    const scope = scopeInput(opts.scope)
    const archiveFilter = archiveInput(opts.archive)
    const page = pageRequest(opts)
    if (scope != null) body.scope = scope
    if (archiveFilter != null) body.archiveFilter = archiveFilter
    if (page != null) body.page = page
    const res = await this.ctx.rest.post(DIRECTORY, 'ListRooms', body, ListRoomsResponseSchema)
    return toPage(res.rooms.map(r => Room.fromViewerState(r, this.ctx)), res.page)
  }

  /** Fetches one visible room with viewer state. DMs require membership. */
  async fetch(roomId: string): Promise<Room> {
    const res = await this.ctx.rest.post(DIRECTORY, 'GetRoom', { roomId }, GetRoomResponseSchema)
    return Room.fromViewerState(res.room, this.ctx)
  }

  /** Fetches up to 100 rooms by ID. Unknown and hidden rooms are omitted; archived ones may be returned. */
  async fetchMany(roomIds: string[]): Promise<Room[]> {
    if (!checkBatch(roomIds, 'room')) return []
    const res = await this.ctx.rest.post(DIRECTORY, 'BatchGetRooms', { roomIds }, BatchGetRoomsResponseSchema)
    return res.rooms.map(r => Room.fromViewerState(r, this.ctx))
  }

  /** Lists channel room groups and their sidebar items, in sidebar order. Hidden and archived rooms are omitted. */
  async listGroups(): Promise<RoomGroup[]> {
    const res = await this.ctx.rest.post(DIRECTORY, 'ListRoomGroups', {}, ListRoomGroupsResponseSchema)
    return res.groups
  }

  /** Fetches one room group. */
  async fetchGroup(groupId: string): Promise<RoomGroup> {
    const res = await this.ctx.rest.post(DIRECTORY, 'GetRoomGroup', { groupId }, GetRoomGroupResponseSchema)
    return res.group
  }

  /** Fetches up to 100 room groups by ID; unknown groups are omitted. */
  async fetchGroups(groupIds: string[]): Promise<RoomGroup[]> {
    if (!checkBatch(groupIds, 'group')) return []
    const res = await this.ctx.rest.post(DIRECTORY, 'BatchGetRoomGroups', { groupIds }, BatchGetRoomGroupsResponseSchema)
    return res.groups
  }

  // --- Lifecycle -------------------------------------------------------------

  /** Creates a channel room in a room group. Requires permission to create rooms in that group. */
  async create(input: CreateRoomInput): Promise<Room> {
    const res = await this.ctx.rest.post(
      ROOMS,
      'CreateRoom',
      {
        name: input.name,
        description: input.description,
        groupId: input.groupId,
        universal: input.universal,
        threadingMode: threadingInput(input.threadingMode),
      },
      RoomMutationResponseSchema,
    )
    return new Room(res.room, this.ctx)
  }

  /** Updates editable room metadata (sends an update mask of the given keys). Requires `room.manage`. */
  async update(roomId: string, input: UpdateRoomInput): Promise<Room> {
    checkSlowMode('slowModeSeconds', input.slowModeSeconds)
    checkSlowMode('threadSlowModeSeconds', input.threadSlowModeSeconds)
    const body: Record<string, unknown> = { roomId }
    const mask: string[] = []
    for (const key of UPDATE_FIELDS) {
      const value = input[key]
      if (value === undefined) continue
      mask.push(key)
      if (value === null) continue
      body[key] = key === 'threadingMode' ? threadingInput(value as ThreadingModeInput) : value
    }
    if (mask.length === 0) {
      throw new ChattoValidationError('empty_update', 'Room update must change at least one field')
    }
    body.updateMask = mask.join(',')
    const res = await this.ctx.rest.post(ROOMS, 'UpdateRoom', body, RoomMutationResponseSchema)
    return new Room(res.room, this.ctx)
  }

  /** Archives a room, hiding it from active room lists. Requires `room.manage`. */
  async archive(roomId: string): Promise<Room> {
    const res = await this.ctx.rest.post(ROOMS, 'ArchiveRoom', { roomId }, RoomMutationResponseSchema)
    return new Room(res.room, this.ctx)
  }

  /** Restores an archived room. Requires `room.manage`. */
  async unarchive(roomId: string): Promise<Room> {
    const res = await this.ctx.rest.post(ROOMS, 'UnarchiveRoom', { roomId }, RoomMutationResponseSchema)
    return new Room(res.room, this.ctx)
  }

  // --- Membership -----------------------------------------------------------

  /** Joins a room as the current user when room permissions allow it. */
  async join(roomId: string): Promise<Room> {
    const res = await this.ctx.rest.post(ROOMS, 'JoinRoom', { roomId }, RoomMutationResponseSchema)
    return new Room(res.room, this.ctx)
  }

  /** Joins every joinable unarchived room in a group. Returns the IDs of newly joined rooms. */
  async joinGroup(groupId: string): Promise<string[]> {
    const res = await this.ctx.rest.post(ROOMS, 'JoinRoomGroup', { groupId }, JoinRoomGroupResponseSchema)
    return res.joinedRoomIds
  }

  /** Leaves a room. DM and universal rooms cannot be left. */
  async leave(roomId: string): Promise<void> {
    await this.ctx.rest.post(ROOMS, 'LeaveRoom', { roomId }, EmptyResponseSchema)
  }

  /**
   * Starts (or fetches the existing) DM with the given users; the caller is
   * always included and no users means the self-DM. New DMs support at most
   * one other user. Human callers only — bots receive PERMISSION_DENIED.
   */
  async startDM(userIds: string | string[] = []): Promise<Room> {
    const participantIds = typeof userIds === 'string' ? [userIds] : userIds
    if (participantIds.length > 9) {
      throw new ChattoValidationError('too_many_participants', 'A DM may name at most 9 other participants')
    }
    const res = await this.ctx.rest.post(ROOMS, 'StartDM', { participantIds }, RoomMutationResponseSchema)
    return new Room(res.room, this.ctx)
  }

  /** Lists effective member user IDs in ascending order. Default 250, max 500 per page. */
  async listMembers(roomId: string, opts: ListMembersOptions = {}): Promise<Page<string>> {
    const res = await this.ctx.rest.post(
      ROOMS,
      'ListMembers',
      {
        roomId,
        search: opts.search,
        page: pageRequest(opts),
        presenceStatuses: opts.presence?.map(presenceInput),
      },
      ListMembersResponseSchema,
    )
    return toPage(res.userIds, res.page)
  }

  /** Fetches one effective member (including universal membership). NOT_FOUND for nonmembers. */
  async fetchMember(roomId: string, userId: string): Promise<User> {
    const res = await this.ctx.rest.post(ROOMS, 'GetMember', { roomId, userId }, MemberResponseSchema)
    return new User(res.member)
  }

  /** Fetches up to 100 members; unknown users and nonmembers are omitted. */
  async fetchMembers(roomId: string, userIds: string[]): Promise<User[]> {
    if (!checkBatch(userIds, 'user')) return []
    const res = await this.ctx.rest.post(ROOMS, 'BatchGetMembers', { roomId, userIds }, BatchGetMembersResponseSchema)
    return res.members.map(m => new User(m))
  }

  /** Adds an explicit channel member. Not allowed for suspended users or archived/universal/DM rooms. */
  async addMember(roomId: string, userId: string): Promise<User> {
    const res = await this.ctx.rest.post(ROOMS, 'AddMember', { roomId, userId }, MemberResponseSchema)
    return new User(res.member)
  }

  /** Removes an explicit channel member. Returns true when a membership was removed. */
  async removeMember(roomId: string, userId: string): Promise<boolean> {
    const res = await this.ctx.rest.post(ROOMS, 'RemoveMember', { roomId, userId }, RemoveMemberResponseSchema)
    return res.removed
  }

  // --- Moderation -------------------------------------------------------------

  /**
   * Removes a member for moderation (replaces the old ban). Requires
   * `room.remove-member`. Without a suspension the user may rejoin under normal
   * rules; universal rooms require one.
   */
  async removeUser(roomId: string, userId: string, opts: RemoveUserOptions): Promise<void> {
    checkReason(opts.reason)
    if (opts.suspendUntil != null && opts.suspendIndefinitely) {
      throw new ChattoValidationError('conflicting_suspension', 'Use either suspendUntil or suspendIndefinitely, not both')
    }
    await this.ctx.rest.post(
      ROOMS,
      'RemoveUser',
      {
        roomId,
        userId,
        reason: opts.reason,
        suspensionExpiresAt: opts.suspendUntil != null ? timestamp(opts.suspendUntil) : undefined,
        suspendIndefinitely: opts.suspendIndefinitely ? true : undefined,
      },
      EmptyResponseSchema,
    )
  }

  /** Lifts a room suspension (succeeds when none exists). Requires `room.remove-member`. */
  async liftSuspension(roomId: string, userId: string, reason: string): Promise<void> {
    checkReason(reason)
    await this.ctx.rest.post(ROOMS, 'LiftSuspension', { roomId, userId, reason }, EmptyResponseSchema)
  }

  /** Lists active suspensions, newest first. Requires server-scope `room.remove-member`. Default 50, max 100. */
  async listSuspensions(opts: ListSuspensionsOptions = {}): Promise<Page<RoomSuspension>> {
    const res = await this.ctx.rest.post(
      ROOMS,
      'ListSuspensions',
      { roomId: opts.roomId, page: pageRequest(opts) },
      ListSuspensionsResponseSchema,
    )
    return toPage(res.suspensions, res.page)
  }

  // --- Notices -----------------------------------------------------------------

  /** Reads a channel notice (empty body when none). Requires membership. */
  async fetchNotice(roomId: string): Promise<RoomNotice> {
    const res = await this.ctx.rest.post(ROOMS, 'GetNotice', { roomId }, RoomNoticeResponseSchema)
    return res.notice
  }

  /**
   * Publishes or corrects a notice (Markdown, 1–4000 chars). Requires
   * `room.manage-notice`. Pass the current `version` as `expectedVersion`.
   */
  async publishNotice(roomId: string, body: string, opts: PublishNoticeOptions = {}): Promise<RoomNotice> {
    if (body.length < 1 || body.length > 4000) {
      throw new ChattoValidationError('invalid_notice_body', 'Notice body must be 1–4000 characters')
    }
    const res = await this.ctx.rest.post(
      ROOMS,
      'PublishNotice',
      { roomId, body, expectedVersion: opts.expectedVersion, republish: opts.republish || undefined },
      RoomNoticeResponseSchema,
    )
    return res.notice
  }

  /** Clears a notice, keeping its version. Same access and version rules as publishing. */
  async clearNotice(roomId: string, opts: { expectedVersion?: string } = {}): Promise<RoomNotice> {
    const res = await this.ctx.rest.post(
      ROOMS,
      'ClearNotice',
      { roomId, expectedVersion: opts.expectedVersion },
      RoomNoticeResponseSchema,
    )
    return res.notice
  }

  // --- Read state ---------------------------------------------------------------

  /** Reads the viewer's stored read marker for a room without changing it. */
  async fetchReadState(roomId: string): Promise<RoomReadState> {
    const res = await this.ctx.rest.post(ROOMS, 'GetRoomReadState', { roomId }, GetRoomReadStateResponseSchema)
    return res.state
  }

  /** Reads up to 100 room read states; missing and inaccessible rooms are omitted. */
  async fetchReadStates(roomIds: string[]): Promise<RoomReadState[]> {
    if (!checkBatch(roomIds, 'room')) return []
    const res = await this.ctx.rest.post(
      ROOMS,
      'BatchGetRoomReadStates',
      { roomIds },
      BatchGetRoomReadStatesResponseSchema,
    )
    return res.states
  }

  /** Marks a room read through `upToEventId` (a root event), or through the latest root event when omitted. */
  async markAsRead(roomId: string, upToEventId?: string): Promise<MarkRoomAsReadResult> {
    return this.ctx.rest.post(ROOMS, 'MarkRoomAsRead', { roomId, upToEventId }, MarkRoomAsReadResponseSchema)
  }

  // --- Pins -------------------------------------------------------------------

  /** Lists a channel's pinned messages, newest pin first. Default 50, max 100. DMs have no pins. */
  async listPins(roomId: string, opts: PageOptions = {}): Promise<PinnedMessagesPage> {
    const res = await this.ctx.rest.post(
      ROOMS,
      'ListPinnedMessages',
      { roomId, page: pageRequest(opts) },
      ListPinnedMessagesResponseSchema,
    )
    const messages = await Promise.all(res.pinnedMessages.map(p => this.ctx.hydrateMessage(p.message)))
    return { ...toPage(messages, res.page), latestPinMarker: res.latestPinMarker }
  }

  /** Pins a message (idempotent). Requires `message.pin`. Thread replies are supported. */
  async pin(roomId: string, messageEventId: string): Promise<Message> {
    const res = await this.ctx.rest.post(
      ROOMS,
      'CreatePinnedMessage',
      { roomId, messageEventId },
      CreatePinnedMessageResponseSchema,
    )
    return this.ctx.hydrateMessage(res.pinnedMessage.message)
  }

  /** Unpins a message (idempotent). Returns true when the message is not pinned afterwards. */
  async unpin(roomId: string, messageEventId: string): Promise<boolean> {
    const res = await this.ctx.rest.post(
      ROOMS,
      'DeletePinnedMessage',
      { roomId, messageEventId },
      DeletePinnedMessageResponseSchema,
    )
    return res.deleted
  }

  // --- Timeline, typing, attachments ------------------------------------------------

  /** Loads one page of the room timeline (all event kinds, oldest first) with included users. */
  async fetchEvents(roomId: string, opts: FetchEventsOptions = {}): Promise<RoomTimelinePage> {
    const res = await this.ctx.rest.post(
      ROOMS,
      'GetRoomEvents',
      {
        roomId,
        limit: opts.limit,
        // `before`/`after` form a oneof, which proto3 JSON encodes flat.
        before: opts.before,
        after: opts.before == null ? opts.after : undefined,
      },
      GetRoomEventsResponseSchema,
    )
    return res.page
  }

  /**
   * Loads a timeline window centred on `eventId` (permalinks, search hits).
   * `targetIndex` is the anchor's index in `events`.
   */
  async fetchEventsAround(
    roomId: string,
    eventId: string,
    opts: { limit?: number } = {},
  ): Promise<RoomTimelinePage & { targetIndex: number }> {
    const res = await this.ctx.rest.post(
      ROOMS,
      'GetRoomEventsAround',
      { roomId, eventId, limit: opts.limit },
      GetRoomEventsAroundResponseSchema,
    )
    return { ...res.page, targetIndex: res.targetIndex }
  }

  /**
   * Refreshes the current user's typing indicator in a room, or in a thread
   * when `threadRootEventId` is given. Send at most every 2 seconds while
   * typing; receivers clear it after 6 seconds without a refresh.
   */
  async sendTyping(roomId: string, threadRootEventId?: string): Promise<void> {
    await this.ctx.rest.post(ROOMS, 'RefreshTypingIndicator', { roomId, threadRootEventId }, EmptyResponseSchema)
  }

  /** Lists current message attachments in a room, newest message first. Default 50, max 100. */
  async listAttachments(
    roomId: string,
    opts: PageOptions & { thumbnail?: ThumbnailOptions } = {},
  ): Promise<Page<RoomAttachment>> {
    const res = await this.ctx.rest.post(
      ROOMS,
      'ListRoomAttachments',
      { roomId, thumbnail: thumbnailInput(opts.thumbnail), page: pageRequest(opts) },
      ListRoomAttachmentsResponseSchema,
    )
    return toPage(
      res.attachments.map(a => ({
        attachment: new Attachment(a.attachment),
        messageEventId: a.messageEventId,
        threadRootEventId: a.threadRootEventId,
        createdAt: a.createdAt,
        description: a.description,
      })),
      res.page,
    )
  }
}
