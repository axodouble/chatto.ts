import type { ClientContext } from '../../context'
import { Room } from '../../resources/room'
import { ChattoValidationError } from '../../errors'
import { inferUpdateMask, stripNulls } from '../../account/mask'
import type { SidebarLink } from '../../schemas/room'
import {
  AdminGetRoomResponseSchema,
  AdminGetRoomGroupResponseSchema,
  AdminRoomGroupsResponseSchema,
  AdminRoomGroupResponseSchema,
  AdminMoveRoomToGroupResponseSchema,
  AdminSidebarLinkResponseSchema,
  AdminRoomLayoutEmptyResponseSchema,
  type AdminRoomLayoutGroup,
} from '../../schemas/admin/room-layout'

const SERVICE = 'chatto.admin.v1.AdminRoomLayoutService'

/** Reference to one sidebar entry: a channel room or a sidebar link. */
export type SidebarItemRef = { roomId: string } | { sidebarLinkId: string }

/** Management-authorized room metadata from {@link AdminRoomLayoutManager.getRoom}. */
export interface AdminRoomDetails {
  room: Room
  /** Whether the caller can update the room's general settings. */
  viewerCanManageRoom: boolean
  /** Whether the caller can configure role permissions for the room. */
  viewerCanManagePermissions: boolean
}

/** Management-authorized group metadata from {@link AdminRoomLayoutManager.getGroup}. */
export interface AdminRoomGroupDetails {
  /** Group metadata. `items` is always empty here (private room names are withheld). */
  group: AdminRoomLayoutGroup
  /** Whether the caller can update the group's general settings. */
  viewerCanManageGroup: boolean
  /** Whether the caller can configure role permissions for the group. */
  viewerCanManagePermissions: boolean
}

export interface CreateRoomGroupInput {
  /** Display name (1–80 chars). */
  name: string
  /** Optional public description (max 500 chars). */
  description?: string
}

export interface UpdateRoomGroupInput {
  /** New display name (1–80 chars). */
  name?: string
  /** New description (max 500 chars); `''` or `null` clears it. */
  description?: string | null
}

export interface CreateSidebarLinkInput {
  /** Display label (1–80 chars). */
  label: string
  /** Absolute http(s) URL or server-local path (1–2048 chars). */
  url: string
}

export interface UpdateSidebarLinkInput {
  /** New display label (1–80 chars). */
  label?: string
  /** New absolute http(s) URL or server-local path (1–2048 chars). */
  url?: string
}

/** Options for patch-style updates. */
export interface UpdateMaskOptions {
  /** Explicit FieldMask (comma-separated camelCase paths, or `*`). Inferred from the given keys by default. */
  updateMask?: string
}

const MAX_ORDER_ITEMS = 1000

function checkLength(field: string, value: string | null | undefined, min: number, max: number): void {
  if (value == null) return
  if (value.length < min || value.length > max) {
    const range = min > 0 ? `${min}–${max}` : `at most ${max}`
    throw new ChattoValidationError(`invalid_${field}`, `${field} must be ${range} characters`)
  }
}

function itemInput(ref: SidebarItemRef): { roomId: string } | { sidebarLinkId: string } {
  if ('roomId' in ref && ref.roomId) return { roomId: ref.roomId }
  if ('sidebarLinkId' in ref && ref.sidebarLinkId) return { sidebarLinkId: ref.sidebarLinkId }
  throw new ChattoValidationError('invalid_sidebar_item', 'Sidebar item needs a roomId or sidebarLinkId')
}

/**
 * Server-admin room layout (`chatto.admin.v1.AdminRoomLayoutService`): room
 * groups, their order, sidebar links and the placement of rooms/links.
 *
 * Most calls require `room.manage` (server-scope or for the affected groups);
 * for admins that usually means activating privileged mode first via
 * `client.viewer.activatePrivilegedMode()`.
 */
export class AdminRoomLayoutManager {
  constructor(private readonly ctx: ClientContext) {}

  // --- Reads -----------------------------------------------------------------

  /**
   * Get a channel room's metadata and the caller's management capabilities.
   * Works without directory visibility. Requires `role.manage` or effective
   * `room.manage` for the room.
   */
  async getRoom(roomId: string): Promise<AdminRoomDetails> {
    const res = await this.ctx.rest.post(SERVICE, 'GetRoom', { roomId }, AdminGetRoomResponseSchema)
    return {
      room: new Room(res.room, this.ctx),
      viewerCanManageRoom: res.viewerCanManageRoom,
      viewerCanManagePermissions: res.viewerCanManagePermissions,
    }
  }

  /**
   * Get a room group's metadata and the caller's management capabilities. The
   * group's `items` are omitted. Requires `role.manage` or effective
   * `room.manage` for the group.
   */
  async getGroup(groupId: string): Promise<AdminRoomGroupDetails> {
    return this.ctx.rest.post(SERVICE, 'GetRoomGroup', { groupId }, AdminGetRoomGroupResponseSchema)
  }

  /**
   * List the full editable layout: ordered groups with their mixed room/link
   * items, including archived rooms. Requires server-scope `room.manage`
   * (privileged mode).
   */
  async listGroups(): Promise<AdminRoomLayoutGroup[]> {
    const res = await this.ctx.rest.post(SERVICE, 'ListRoomGroups', {}, AdminRoomGroupsResponseSchema)
    return res.groups
  }

  // --- Room groups -----------------------------------------------------------

  /** Create a room group (appended to the sidebar). Requires server-scope `room.manage` (privileged mode). */
  async createGroup(input: CreateRoomGroupInput): Promise<AdminRoomLayoutGroup> {
    checkLength('name', input.name, 1, 80)
    checkLength('description', input.description, 0, 500)
    const res = await this.ctx.rest.post(
      SERVICE,
      'CreateRoomGroup',
      { name: input.name, description: input.description || undefined },
      AdminRoomGroupResponseSchema,
    )
    return res.group
  }

  /**
   * Update a room group's name/description. Only given keys change; `null`
   * resets the field. Requires effective `room.manage` for the group.
   */
  async updateGroup(groupId: string, input: UpdateRoomGroupInput, opts: UpdateMaskOptions = {}): Promise<AdminRoomLayoutGroup> {
    checkLength('name', input.name, 1, 80)
    checkLength('description', input.description, 0, 500)
    const updateMask = opts.updateMask ?? inferUpdateMask(input as Record<string, unknown>)
    if (updateMask === '') {
      throw new ChattoValidationError('empty_update', 'updateGroup needs at least one field')
    }
    const res = await this.ctx.rest.post(
      SERVICE,
      'UpdateRoomGroup',
      { groupId, ...stripNulls(input as Record<string, unknown>), updateMask },
      AdminRoomGroupResponseSchema,
    )
    return res.group
  }

  /** Delete an empty room group. Requires effective `room.manage` for the group. */
  async deleteGroup(groupId: string): Promise<void> {
    await this.ctx.rest.post(SERVICE, 'DeleteRoomGroup', { groupId }, AdminRoomLayoutEmptyResponseSchema)
  }

  /**
   * Replace the global group order. Must list every existing group exactly
   * once (1–1000 IDs). Returns the groups in their new order. Requires
   * server-scope `room.manage` (privileged mode).
   */
  async reorderGroups(orderedGroupIds: string[]): Promise<AdminRoomLayoutGroup[]> {
    if (orderedGroupIds.length === 0 || orderedGroupIds.length > MAX_ORDER_ITEMS) {
      throw new ChattoValidationError('invalid_group_order', 'reorderGroups needs 1–1000 group IDs')
    }
    const res = await this.ctx.rest.post(SERVICE, 'ReorderRoomGroups', { orderedGroupIds }, AdminRoomGroupsResponseSchema)
    return res.groups
  }

  /**
   * Move one group immediately before `beforeGroupId`, or to the end when
   * omitted. Returns all groups in their new order. Requires server-scope
   * `room.manage` (privileged mode).
   */
  async moveGroup(groupId: string, beforeGroupId?: string): Promise<AdminRoomLayoutGroup[]> {
    const res = await this.ctx.rest.post(
      SERVICE,
      'MoveRoomGroup',
      { groupId, beforeGroupId: beforeGroupId || undefined },
      AdminRoomGroupsResponseSchema,
    )
    return res.groups
  }

  // --- Rooms and sidebar items -----------------------------------------------

  /** Move a channel room to another group. Requires `room.manage` in both groups. */
  async moveRoomToGroup(roomId: string, groupId: string): Promise<Room> {
    const res = await this.ctx.rest.post(SERVICE, 'MoveRoomToGroup', { roomId, groupId }, AdminMoveRoomToGroupResponseSchema)
    return new Room(res.room, this.ctx)
  }

  /**
   * Replace the mixed room/link order inside one group (max 1000 items).
   * Requires `room.manage` in that group.
   */
  async reorderItems(groupId: string, items: SidebarItemRef[]): Promise<AdminRoomLayoutGroup> {
    if (items.length > MAX_ORDER_ITEMS) {
      throw new ChattoValidationError('too_many_items', 'At most 1000 sidebar items may be ordered at once')
    }
    const res = await this.ctx.rest.post(
      SERVICE,
      'ReorderSidebarItemsInGroup',
      { groupId, items: items.map(itemInput) },
      AdminRoomGroupResponseSchema,
    )
    return res.group
  }

  /**
   * Move one room or sidebar link into `groupId`, before `before` (or last
   * when omitted). Returns the destination group. Requires `room.manage` in
   * the source and destination groups.
   */
  async moveItem(item: SidebarItemRef, groupId: string, before?: SidebarItemRef): Promise<AdminRoomLayoutGroup> {
    const res = await this.ctx.rest.post(
      SERVICE,
      'MoveSidebarItem',
      { item: itemInput(item), groupId, before: before ? itemInput(before) : undefined },
      AdminRoomGroupResponseSchema,
    )
    return res.group
  }

  // --- Sidebar links ---------------------------------------------------------

  /** Create a sidebar link in a group. Requires `room.manage` in that group. */
  async createSidebarLink(groupId: string, input: CreateSidebarLinkInput): Promise<SidebarLink> {
    checkLength('label', input.label, 1, 80)
    checkLength('url', input.url, 1, 2048)
    const res = await this.ctx.rest.post(
      SERVICE,
      'CreateSidebarLink',
      { groupId, label: input.label, url: input.url },
      AdminSidebarLinkResponseSchema,
    )
    return res.sidebarLink
  }

  /**
   * Update a sidebar link's label/URL. Only given keys change. Requires
   * `room.manage` in the link's current group.
   */
  async updateSidebarLink(linkId: string, input: UpdateSidebarLinkInput, opts: UpdateMaskOptions = {}): Promise<SidebarLink> {
    checkLength('label', input.label, 1, 80)
    checkLength('url', input.url, 1, 2048)
    const updateMask = opts.updateMask ?? inferUpdateMask(input as Record<string, unknown>)
    if (updateMask === '') {
      throw new ChattoValidationError('empty_update', 'updateSidebarLink needs at least one field')
    }
    const res = await this.ctx.rest.post(
      SERVICE,
      'UpdateSidebarLink',
      { linkId, ...stripNulls(input as Record<string, unknown>), updateMask },
      AdminSidebarLinkResponseSchema,
    )
    return res.sidebarLink
  }

  /** Delete a sidebar link. Requires `room.manage` in the link's current group. */
  async deleteSidebarLink(linkId: string): Promise<void> {
    await this.ctx.rest.post(SERVICE, 'DeleteSidebarLink', { linkId }, AdminRoomLayoutEmptyResponseSchema)
  }

  /** Move a sidebar link to another group. Requires `room.manage` in both groups. */
  async moveSidebarLinkToGroup(linkId: string, groupId: string): Promise<SidebarLink> {
    const res = await this.ctx.rest.post(
      SERVICE,
      'MoveSidebarLinkToGroup',
      { linkId, groupId },
      AdminSidebarLinkResponseSchema,
    )
    return res.sidebarLink
  }
}
