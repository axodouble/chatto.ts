import type { ClientContext } from '../../context'
import type { UserData } from '../../types'
import { ChattoValidationError } from '../../errors'
import { inferUpdateMask, stripNulls } from '../../account/mask'
import { type Page, type PageOptions, pageRequest, toPage } from '../../util/page'
import {
  AdminListRolesResponseSchema,
  AdminGetRoleResponseSchema,
  AdminListRoleMembersResponseSchema,
  AdminRoleResponseSchema,
  AdminReorderRolesResponseSchema,
  AdminRoleEmptyResponseSchema,
  type AdminRole,
  type AdminRoleCatalog,
  type AdminRoleDetail,
} from '../../schemas/admin/roles'

const SERVICE = 'chatto.admin.v1.AdminRoleService'

export interface CreateRoleOptions {
  /** Stable role name (non-empty, fixed after creation). */
  name: string
  /** Display name shown in admin and mention UIs (max 80 chars). */
  displayName?: string
  /** Optional description (max 500 chars). */
  description?: string
  /** Whether messages may notify (ping) users assigned to this role. */
  pingable?: boolean
}

/** Patch for `update`. Only keys present are applied; `null` resets the field to its default. */
export interface UpdateRoleInput {
  /** Max 80 chars. */
  displayName?: string | null
  /** Max 500 chars. `''` or `null` clears it. */
  description?: string | null
  pingable?: boolean | null
}

/**
 * Role definitions (`chatto.admin.v1.AdminRoleService`). Reads need only an
 * authenticated user; writes require `role.manage` (privileged mode for human
 * sessions — `client.viewer.activatePrivilegedMode()`). Permission decisions
 * of a role are managed via `AdminPermissionManager`; assigning roles to users
 * via `AdminUserManager`.
 */
export class AdminRoleManager {
  constructor(private readonly ctx: ClientContext) {}

  /**
   * The role catalog (sorted by position) with member/grant/denial counts
   * (reported for callers with `role.manage` or `role.assign`) and the
   * caller's role-management capabilities.
   */
  async list(): Promise<AdminRoleCatalog> {
    return this.ctx.rest.post(SERVICE, 'ListRoles', {}, AdminListRolesResponseSchema)
  }

  /** One role plus the caller's capabilities. NOT_FOUND for unknown roles. */
  async fetch(name: string): Promise<AdminRoleDetail> {
    return this.ctx.rest.post(SERVICE, 'GetRole', { name }, AdminGetRoleResponseSchema)
  }

  /**
   * Explicit members of a role, sorted by user ID (default 20, max 100 per
   * page). `everyone` has no explicit members. Requires `role.assign`.
   */
  async listMembers(name: string, opts: PageOptions = {}): Promise<Page<UserData>> {
    if (opts.limit != null && opts.limit > 100) {
      throw new ChattoValidationError('page_limit_too_large', 'At most 100 role members may be listed per page')
    }
    const res = await this.ctx.rest.post(
      SERVICE,
      'ListMembers',
      { name, page: pageRequest(opts) },
      AdminListRoleMembersResponseSchema,
    )
    return toPage(res.members, res.page)
  }

  /** Create a custom role. Requires `role.manage`. */
  async create(opts: CreateRoleOptions): Promise<AdminRole> {
    validateRoleText(opts.displayName, opts.description)
    const res = await this.ctx.rest.post(
      SERVICE,
      'CreateRole',
      {
        name: opts.name,
        displayName: opts.displayName || undefined,
        description: opts.description || undefined,
        pingable: opts.pingable || undefined,
      },
      AdminRoleResponseSchema,
    )
    return res.role
  }

  /** Patch role metadata (only the given keys, sent as the field mask). Requires `role.manage`. */
  async update(name: string, changes: UpdateRoleInput): Promise<AdminRole> {
    const updateMask = inferUpdateMask(changes as Record<string, unknown>)
    if (!updateMask) {
      throw new ChattoValidationError('empty_update', 'At least one of displayName, description or pingable must be given')
    }
    validateRoleText(changes.displayName, changes.description)
    const res = await this.ctx.rest.post(
      SERVICE,
      'UpdateRole',
      { name, ...stripNulls(changes as Record<string, unknown>), updateMask },
      AdminRoleResponseSchema,
    )
    return res.role
  }

  /** Delete a custom role. Requires `role.manage`. */
  async delete(name: string): Promise<void> {
    await this.ctx.rest.post(SERVICE, 'DeleteRole', { name }, AdminRoleEmptyResponseSchema)
  }

  /**
   * Replace the custom role order. Must list **every custom role exactly
   * once**; system roles keep fixed positions and must not be included (max
   * 1000). Returns the full catalog afterwards. Requires `role.manage`.
   */
  async reorder(roleNames: string[]): Promise<AdminRole[]> {
    if (roleNames.length > 1000) {
      throw new ChattoValidationError('too_many_role_names', 'At most 1000 roles may be reordered')
    }
    const res = await this.ctx.rest.post(SERVICE, 'ReorderRoles', { roleNames }, AdminReorderRolesResponseSchema)
    return res.roles
  }
}

function validateRoleText(displayName?: string | null, description?: string | null) {
  if (displayName != null && [...displayName].length > 80) {
    throw new ChattoValidationError('display_name_too_long', 'Role display name must be at most 80 characters')
  }
  if (description != null && [...description].length > 500) {
    throw new ChattoValidationError('description_too_long', 'Role description must be at most 500 characters')
  }
}
