import { z } from 'zod'
import { PageInfoSchema } from '../page'
import { RoleSchema } from '../role'
import { UserSchema } from '../user'

/**
 * Role metadata plus admin totals (`chatto.admin.v1.AdminRole`). The counts
 * are uint64 (JSON strings) and only reported by `AdminRoleService.ListRoles`
 * for callers with `role.manage` or `role.assign`; elsewhere they are absent.
 */
export const AdminRoleSchema = z.object({
  role: RoleSchema,
  /** Active human members, including implicit membership for `everyone`. */
  memberCount: z.coerce.number().optional(),
  /** Explicit grants across all scopes (excludes virtual owner access). */
  permissionGrantCount: z.coerce.number().optional(),
  /** Explicit denials across all scopes. */
  permissionDenialCount: z.coerce.number().optional(),
})
export type AdminRole = z.infer<typeof AdminRoleSchema>

export const AdminListRolesResponseSchema = z.object({
  roles: z.array(AdminRoleSchema).default([]),
  viewerCanManageRoles: z.boolean().default(false),
  viewerCanAssignRoles: z.boolean().default(false),
})
/** Role catalog snapshot (sorted by position) plus the caller's role-management capabilities. */
export type AdminRoleCatalog = z.infer<typeof AdminListRolesResponseSchema>

export const AdminGetRoleResponseSchema = z.object({
  role: AdminRoleSchema,
  viewerCanManageRoles: z.boolean().default(false),
  viewerCanAssignRoles: z.boolean().default(false),
})
/** One role plus the caller's role-management capabilities. */
export type AdminRoleDetail = z.infer<typeof AdminGetRoleResponseSchema>

export const AdminListRoleMembersResponseSchema = z.object({
  members: z.array(UserSchema).default([]),
  page: PageInfoSchema.optional(),
})

export const AdminRoleResponseSchema = z.object({ role: AdminRoleSchema })
export const AdminReorderRolesResponseSchema = z.object({ roles: z.array(AdminRoleSchema).default([]) })
export const AdminRoleEmptyResponseSchema = z.object({})
