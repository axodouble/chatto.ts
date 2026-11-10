import { z } from 'zod'
import { RoomSchema, SidebarLinkSchema } from '../room'

/**
 * One ordered sidebar entry in the admin layout: exactly one of `room` /
 * `sidebarLink` is set (proto oneof). Unlike the public directory, `room` is a
 * plain `Room` without viewer state and may be archived.
 */
export const AdminRoomLayoutItemSchema = z.object({
  room: RoomSchema.optional(),
  sidebarLink: SidebarLinkSchema.optional(),
})

/** Room group as returned by `chatto.admin.v1.AdminRoomLayoutService`. */
export const AdminRoomLayoutGroupSchema = z.object({
  id: z.string(),
  name: z.string().default(''),
  /** Public group description; `''` when unset. */
  description: z.string().default(''),
  /** Mixed room / sidebar-link entries in sidebar order. */
  items: z.array(AdminRoomLayoutItemSchema).default([]),
  /** Whether the viewer can create rooms in this group. */
  canCreateRoom: z.boolean().default(false),
})

export const AdminGetRoomResponseSchema = z.object({
  room: RoomSchema,
  viewerCanManageRoom: z.boolean().default(false),
  viewerCanManagePermissions: z.boolean().default(false),
})

export const AdminGetRoomGroupResponseSchema = z.object({
  group: AdminRoomLayoutGroupSchema,
  viewerCanManageGroup: z.boolean().default(false),
  viewerCanManagePermissions: z.boolean().default(false),
})

/** Response carrying the full ordered group list (List/Reorder/MoveRoomGroup). */
export const AdminRoomGroupsResponseSchema = z.object({
  groups: z.array(AdminRoomLayoutGroupSchema).default([]),
})

/** Response carrying one group (Create/Update group, ReorderSidebarItemsInGroup, MoveSidebarItem). */
export const AdminRoomGroupResponseSchema = z.object({ group: AdminRoomLayoutGroupSchema })

export const AdminMoveRoomToGroupResponseSchema = z.object({ room: RoomSchema })

/** Response carrying one sidebar link (Create/Update/MoveSidebarLinkToGroup). */
export const AdminSidebarLinkResponseSchema = z.object({ sidebarLink: SidebarLinkSchema })

export const AdminRoomLayoutEmptyResponseSchema = z.object({})

export type AdminRoomLayoutItem = z.infer<typeof AdminRoomLayoutItemSchema>
export type AdminRoomLayoutGroup = z.infer<typeof AdminRoomLayoutGroupSchema>
