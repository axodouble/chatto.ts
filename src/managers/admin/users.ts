import type { ClientContext } from '../../context'
import { ChattoValidationError } from '../../errors'
import { type Page, type PageOptions, pageRequest, toPage } from '../../util/page'
import {
  AdminListMembersResponseSchema,
  AdminGetMemberResponseSchema,
  AdminBatchGetMembersResponseSchema,
  AdminGetUserRoleAssignmentsResponseSchema,
  AdminMemberResponseSchema,
  AdminUserEmptyResponseSchema,
  type AdminMember,
  type AdminMemberBatch,
  type AdminMemberDetail,
  type UserRoleAssignments,
} from '../../schemas/admin/users'

const SERVICE = 'chatto.admin.v1.AdminUserService'

export interface ListAdminMembersOptions extends PageOptions {
  /** Case-insensitive login/display-name search. */
  search?: string
}

/** A page of admin member rows plus the listed IDs (advance `offset` by `userIds.length`). */
export interface AdminMemberPage extends Page<AdminMember> {
  /** IDs in list order, including any a concurrent change made unloadable. */
  userIds: string[]
}

/** Identify a member by stable user ID or by login. A plain string is a user ID. */
export type AdminMemberTarget = string | { userId: string } | { login: string }

/**
 * Server-admin user management (`chatto.admin.v1.AdminUserService`): member
 * reads, role assignment, passwords, deactivation and deletion. Human callers
 * need privileged mode for these admin permissions
 * (`client.viewer.activatePrivilegedMode()`).
 */
export class AdminUserManager {
  constructor(private readonly ctx: ClientContext) {}

  /**
   * List member IDs only (oldest account first; default 20, max 100 per
   * page). Requires `admin.view-users`. See {@link list} for full rows.
   */
  async listIds(opts: ListAdminMembersOptions = {}): Promise<Page<string>> {
    if (opts.limit != null && opts.limit > 100) {
      throw new ChattoValidationError('page_limit_too_large', 'At most 100 members may be listed per page')
    }
    const res = await this.ctx.rest.post(
      SERVICE,
      'ListMembers',
      { search: opts.search || undefined, page: pageRequest(opts) },
      AdminListMembersResponseSchema,
    )
    return toPage(res.userIds, res.page)
  }

  /**
   * List members with their admin rows (ListMembers + BatchGetMembers).
   * Requires `admin.view-users`. Rows deleted between the two calls are
   * omitted from `items`; advance the offset by `userIds.length`.
   */
  async list(opts: ListAdminMembersOptions = {}): Promise<AdminMemberPage> {
    const ids = await this.listIds(opts)
    const { members } = await this.fetchMany(ids.items)
    return { items: members, userIds: ids.items, totalCount: ids.totalCount, hasMore: ids.hasMore }
  }

  /**
   * One member by user ID (plain string or `{ userId }`) or `{ login }`, plus
   * role/permission metadata for an admin detail view. Requires
   * `admin.view-users`. NOT_FOUND for unknown users.
   */
  async fetch(target: AdminMemberTarget): Promise<AdminMemberDetail> {
    const body = typeof target === 'string' ? { userId: target } : target
    return this.ctx.rest.post(SERVICE, 'GetMember', body, AdminGetMemberResponseSchema)
  }

  /**
   * Admin rows for up to 100 users (first-seen order, de-duplicated; unknown
   * IDs omitted) plus public role metadata. Requires `admin.view-users`.
   */
  async fetchMany(userIds: string[]): Promise<AdminMemberBatch> {
    if (userIds.length === 0) return { members: [], roles: [] }
    if (userIds.length > 100) {
      throw new ChattoValidationError('too_many_user_ids', 'At most 100 members may be fetched at once')
    }
    return this.ctx.rest.post(SERVICE, 'BatchGetMembers', { userIds }, AdminBatchGetMembersResponseSchema)
  }

  /**
   * Explicit roles of a **human** user plus what the caller may assign/revoke.
   * Requires `role.assign` with privileged mode (not `admin.view-users`).
   * FAILED_PRECONDITION for bots, NOT_FOUND for unknown/deleted users.
   */
  async getRoleAssignments(userId: string): Promise<UserRoleAssignments> {
    const res = await this.ctx.rest.post(
      SERVICE,
      'GetUserRoleAssignments',
      { userId },
      AdminGetUserRoleAssignmentsResponseSchema,
    )
    return res.assignments
  }

  /**
   * Assign a role. Requires `role.assign`; non-owners may only assign roles
   * whose authority they already hold. Returns the updated member.
   */
  async assignRole(userId: string, roleName: string): Promise<AdminMember> {
    const res = await this.ctx.rest.post(SERVICE, 'AssignRole', { userId, roleName }, AdminMemberResponseSchema)
    return res.member
  }

  /**
   * Revoke a role. Requires `role.assign`; non-owners may only revoke roles
   * within their authority. Returns the updated member.
   */
  async revokeRole(userId: string, roleName: string): Promise<AdminMember> {
    const res = await this.ctx.rest.post(SERVICE, 'RevokeRole', { userId, roleName }, AdminMemberResponseSchema)
    return res.member
  }

  /**
   * Set another user's password (8–128 chars, server password policy).
   * Requires `user.manage-accounts` and a *fresh* caller credential (a
   * recent sign-in). The caller cannot target their own account.
   */
  async changePassword(userId: string, password: string): Promise<AdminMember> {
    const len = [...password].length
    if (len < 8 || len > 128) {
      throw new ChattoValidationError('invalid_password_length', 'Password must be 8–128 characters')
    }
    const res = await this.ctx.rest.post(
      SERVICE,
      'ChangeUserPassword',
      { userId, password },
      AdminMemberResponseSchema,
    )
    return res.member
  }

  /** Clear a user's username-change cooldown. Requires `user.manage-accounts` (also for yourself). */
  async clearUsernameCooldown(userId: string): Promise<void> {
    await this.ctx.rest.post(SERVICE, 'ClearUsernameCooldown', { userId }, AdminUserEmptyResponseSchema)
  }

  /**
   * Delete a user account (irreversible; also deletes bots the user owns).
   * Requires `user.delete-any` (or `user.delete-self` for yourself).
   */
  async delete(userId: string): Promise<void> {
    await this.ctx.rest.post(SERVICE, 'DeleteUser', { userId }, AdminUserEmptyResponseSchema)
  }

  /**
   * Deactivate (`true`) or reactivate (`false`) a human account without
   * deleting data. Deactivation ends existing sessions and blocks sign-in;
   * reactivation allows new sign-ins. Idempotent. Requires
   * `user.manage-accounts`; not allowed for yourself or owner accounts.
   */
  async setDeactivated(userId: string, deactivated: boolean): Promise<AdminMember> {
    const res = await this.ctx.rest.post(
      SERVICE,
      'SetUserDeactivated',
      { userId, deactivated },
      AdminMemberResponseSchema,
    )
    return res.member
  }
}
