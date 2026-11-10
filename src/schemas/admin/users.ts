import { z } from 'zod'
import { PageInfoSchema } from '../page'
import { RoleSchema } from '../role'
import { UserSchema } from '../user'
import { AdminRoleSchema } from './roles'

/**
 * Admin view of a user (`chatto.admin.v1.AdminMember`): the public user record
 * plus member metadata whose visibility depends on the caller.
 */
export const AdminMemberSchema = z.object({
  /** Public identity fields. */
  user: UserSchema,
  /** Explicit role assignments; the implicit `everyone` role is omitted. */
  roles: z.array(z.string()).default([]),
  /** Account creation time (RFC 3339), when known. */
  createdAt: z.string().optional(),
  /** Whether the caller may see that a verified email exists, and one does. */
  hasVerifiedEmail: z.boolean().default(false),
  /** Verified email addresses visible to the caller. */
  verifiedEmails: z.array(z.string()).default([]),
  /** Whether the caller may delete this account. */
  viewerCanDeleteAccount: z.boolean().default(false),
  /** Start of the current username-change cooldown, when visible and known. */
  lastLoginChange: z.string().optional(),
  /** Primary verified email; absent when none exists or it is not visible. */
  primaryVerifiedEmail: z.string().optional(),
  /** Deactivated accounts keep their data but cannot use the server. */
  deactivated: z.boolean().default(false),
  /** Whether the caller may (de)activate this account; absent on servers without deactivation. */
  viewerCanChangeDeactivation: z.boolean().optional(),
})
export type AdminMember = z.infer<typeof AdminMemberSchema>

export const AdminListMembersResponseSchema = z.object({
  page: PageInfoSchema.optional(),
  userIds: z.array(z.string()).default([]),
})

export const AdminGetMemberResponseSchema = z.object({
  member: AdminMemberSchema,
  /** Roles for an assignment UI. */
  roles: z.array(AdminRoleSchema).default([]),
  /** Permissions available for per-user overrides. */
  availablePermissions: z.array(z.string()).default([]),
  viewerCanAssignRoles: z.boolean().default(false),
  viewerCanManageRoles: z.boolean().default(false),
  viewerCanManageUserPermissions: z.boolean().default(false),
  /** Roles the caller may assign (authoritative when `roleAssignmentLimitsEnforced`). */
  assignableRoleNames: z.array(z.string()).default([]),
  /** Roles the caller may revoke (authoritative when `roleAssignmentLimitsEnforced`). */
  revocableRoleNames: z.array(z.string()).default([]),
  roleAssignmentLimitsEnforced: z.boolean().default(false),
})
/** One member plus role/permission metadata for an admin detail view. */
export type AdminMemberDetail = z.infer<typeof AdminGetMemberResponseSchema>

export const AdminBatchGetMembersResponseSchema = z.object({
  /** Found members, first-seen request order, de-duplicated. Unknown IDs are omitted. */
  members: z.array(AdminMemberSchema).default([]),
  /** Public roles for display-name lookup. */
  roles: z.array(RoleSchema).default([]),
})
export type AdminMemberBatch = z.infer<typeof AdminBatchGetMembersResponseSchema>

export const UserRoleAssignmentsSchema = z.object({
  userId: z.string().default(''),
  /** Roles explicitly assigned to the user (no `everyone`). */
  roleNames: z.array(z.string()).default([]),
  /** Roles within the caller's current grant authority. */
  assignableRoleNames: z.array(z.string()).default([]),
  /** Roles within the caller's current revoke authority for this user. */
  revocableRoleNames: z.array(z.string()).default([]),
})
export type UserRoleAssignments = z.infer<typeof UserRoleAssignmentsSchema>

export const AdminGetUserRoleAssignmentsResponseSchema = z.object({
  assignments: UserRoleAssignmentsSchema.prefault({}),
})

/** Response of AssignRole / RevokeRole / ChangeUserPassword / SetUserDeactivated. */
export const AdminMemberResponseSchema = z.object({ member: AdminMemberSchema })
export const AdminUserEmptyResponseSchema = z.object({})
