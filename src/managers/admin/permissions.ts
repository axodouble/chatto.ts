import type { ClientContext } from '../../context'
import { ChattoValidationError } from '../../errors'
import { type PageOptions, pageRequest } from '../../util/page'
import {
  PERMISSION_DECISIONS,
  PERMISSION_SCOPE_KINDS,
  GetRolePermissionTierMatrixResponseSchema,
  GetRolePermissionMatrixResponseSchema,
  GetUserPermissionMatrixResponseSchema,
  ListRolePermissionDecisionsResponseSchema,
  ListUserPermissionDecisionsResponseSchema,
  ExplainPermissionsResponseSchema,
  SetPermissionResponseSchema,
  type PermissionDecision,
  type PermissionDecisionPage,
  type PermissionDecisionUpdate,
  type PermissionExplanation,
  type PermissionScope,
  type PermissionScopeKind,
  type RolePermissionMatrix,
  type RolePermissionTierMatrix,
  type UserPermissionMatrix,
} from '../../schemas/admin/permissions'

const SERVICE = 'chatto.admin.v1.AdminPermissionService'

/**
 * Where a permission decision applies:
 * - `'server'` — server-wide (the default when omitted)
 * - `'dm'` — the server-wide **Direct messages** scope
 * - `{ groupId }` — one room group
 * - `{ roomId }` — one room
 * - `{ kind, id? }` — a raw `PermissionScope` (e.g. from a matrix/decision read)
 */
export type PermissionScopeInput =
  | 'server'
  | 'dm'
  | { groupId: string }
  | { roomId: string }
  | { kind: PermissionScopeKind; id?: string }

/**
 * A decision to store. `'allow'` / `'deny'` set an explicit decision and
 * `'none'` clears it. Raw `PERMISSION_DECISION_*` names are accepted too
 * (except `UNSPECIFIED`).
 */
export type PermissionDecisionInput = 'allow' | 'deny' | 'none' | PermissionDecision

/** Convert a friendly scope to the wire `PermissionScope` (`{ kind, id? }`). */
export function toPermissionScope(scope: PermissionScopeInput): { kind: PermissionScopeKind; id?: string } {
  if (scope === 'server') return { kind: 'PERMISSION_SCOPE_KIND_SERVER' }
  if (scope === 'dm') return { kind: 'PERMISSION_SCOPE_KIND_DM' }
  if (typeof scope === 'object' && scope != null) {
    if ('roomId' in scope) return { kind: 'PERMISSION_SCOPE_KIND_ROOM', id: requireId(scope.roomId, 'roomId') }
    if ('groupId' in scope) return { kind: 'PERMISSION_SCOPE_KIND_GROUP', id: requireId(scope.groupId, 'groupId') }
    if ('kind' in scope && (PERMISSION_SCOPE_KINDS as readonly string[]).includes(scope.kind)) {
      const needsId = scope.kind === 'PERMISSION_SCOPE_KIND_GROUP' || scope.kind === 'PERMISSION_SCOPE_KIND_ROOM'
      if (needsId) return { kind: scope.kind, id: requireId(scope.id, 'id') }
      // SERVER, DM (and UNSPECIFIED = server) require an empty ID.
      return { kind: scope.kind }
    }
  }
  throw new ChattoValidationError('invalid_permission_scope', `Invalid permission scope: ${JSON.stringify(scope)}`)
}

function requireId(id: string | undefined, field: string): string {
  if (!id) throw new ChattoValidationError('invalid_permission_scope', `Permission scope ${field} must not be empty`)
  return id
}

/** Convert a friendly decision to its `PERMISSION_DECISION_*` wire name. */
export function toPermissionDecision(decision: PermissionDecisionInput): PermissionDecision {
  switch (decision) {
    case 'allow':
      return 'PERMISSION_DECISION_ALLOW'
    case 'deny':
      return 'PERMISSION_DECISION_DENY'
    case 'none':
      return 'PERMISSION_DECISION_NONE'
  }
  if (decision !== 'PERMISSION_DECISION_UNSPECIFIED' && PERMISSION_DECISIONS.includes(decision)) return decision
  throw new ChattoValidationError('invalid_permission_decision', `Invalid permission decision: ${String(decision)}`)
}

const scopeField = (scope?: PermissionScopeInput) => (scope == null ? undefined : toPermissionScope(scope))

export interface PermissionMatrixOptions {
  /** Only read this scope. Omit to read every scope. Missing/inaccessible scopes yield an empty matrix. */
  scope?: PermissionScopeInput
  /**
   * Include the **Direct messages** scope column. Defaults to `true` here (the
   * raw API defaults to `false` for older clients). A `scope: 'dm'` filter
   * selects DM regardless.
   */
  includeDirectMessageScope?: boolean
}

export interface PermissionDecisionListOptions extends PermissionMatrixOptions, PageOptions {
  /** Scopes per page (default 20, max 100). Offsets count scopes, not decisions. */
  limit?: number
}

/**
 * Admin permission reads and writes (`chatto.admin.v1.AdminPermissionService`):
 * role and per-user permission matrices at server, room-group, room, and
 * Direct-messages scope.
 *
 * Scopes are ordered SERVER, DM, then each GROUP followed by its ROOMs.
 * Human callers typically need privileged mode
 * (`client.viewer.activatePrivilegedMode()`) for the admin permissions
 * involved (`role.manage`, `user.manage-permissions`). Managing a **bot's**
 * permissions only needs ownership of the bot (or `bot.manage`).
 */
export class AdminPermissionManager {
  constructor(private readonly ctx: ClientContext) {}

  /**
   * Role-permission matrix for a single tier (default: server). Server scope
   * requires `role.manage`; group/room scopes also accept effective
   * `room.manage` there.
   */
  async getRoleTierMatrix(scope?: PermissionScopeInput): Promise<RolePermissionTierMatrix> {
    const res = await this.ctx.rest.post(
      SERVICE,
      'GetRolePermissionTierMatrix',
      { scope: scopeField(scope) },
      GetRolePermissionTierMatrixResponseSchema,
    )
    return res.matrix
  }

  /** Complete permission matrix of one role (sparse cells). Requires `role.manage`. NOT_FOUND for unknown roles. */
  async getRoleMatrix(roleName: string, opts: PermissionMatrixOptions = {}): Promise<RolePermissionMatrix> {
    const res = await this.ctx.rest.post(
      SERVICE,
      'GetRolePermissionMatrix',
      { roleName, includeDirectMessageScope: opts.includeDirectMessageScope ?? true, scope: scopeField(opts.scope) },
      GetRolePermissionMatrixResponseSchema,
    )
    return res.matrix
  }

  /**
   * One role's explicit/effective decisions as rows, paginated by scope
   * (default 20, max 100 scopes per page). Requires `role.manage`.
   */
  async listRoleDecisions(roleName: string, opts: PermissionDecisionListOptions = {}): Promise<PermissionDecisionPage> {
    checkLimit(opts.limit)
    const res = await this.ctx.rest.post(
      SERVICE,
      'ListRolePermissionDecisions',
      {
        roleName,
        includeDirectMessageScope: opts.includeDirectMessageScope ?? true,
        page: pageRequest(opts),
        scope: scopeField(opts.scope),
      },
      ListRolePermissionDecisionsResponseSchema,
    )
    return toDecisionPage(res)
  }

  /**
   * Complete permission matrix of one user (sparse cells). Human targets
   * require `user.manage-permissions`; bot targets require ownership or
   * `bot.manage`. NOT_FOUND for unknown users.
   */
  async getUserMatrix(userId: string, opts: PermissionMatrixOptions = {}): Promise<UserPermissionMatrix> {
    const res = await this.ctx.rest.post(
      SERVICE,
      'GetUserPermissionMatrix',
      { userId, includeDirectMessageScope: opts.includeDirectMessageScope ?? true, scope: scopeField(opts.scope) },
      GetUserPermissionMatrixResponseSchema,
    )
    return res.matrix
  }

  /**
   * One user's explicit/effective decisions as rows, paginated by scope
   * (default 20, max 100 scopes per page). Same authorization as
   * {@link getUserMatrix}.
   */
  async listUserDecisions(userId: string, opts: PermissionDecisionListOptions = {}): Promise<PermissionDecisionPage> {
    checkLimit(opts.limit)
    const res = await this.ctx.rest.post(
      SERVICE,
      'ListUserPermissionDecisions',
      {
        userId,
        includeDirectMessageScope: opts.includeDirectMessageScope ?? true,
        page: pageRequest(opts),
        scope: scopeField(opts.scope),
      },
      ListUserPermissionDecisionsResponseSchema,
    )
    return toDecisionPage(res)
  }

  /**
   * Explain how every permission applicable at `scope` (default: server)
   * resolves for a user, with the full decision trace. Requires `role.manage`.
   * (A live 0.5.0 server answered PERMISSION_DENIED when an owner explained
   * their own account; explaining other users and bots works.)
   */
  async explain(userId: string, scope?: PermissionScopeInput): Promise<PermissionExplanation[]> {
    const res = await this.ctx.rest.post(
      SERVICE,
      'ExplainPermissions',
      { userId, scope: scopeField(scope) },
      ExplainPermissionsResponseSchema,
    )
    return res.explanations
  }

  /**
   * Set a role's decision for one permission — or several, given an array
   * (sent as sequential RPCs; stops at the first error) — at `scope` (default:
   * server). `'none'` clears the explicit decision. Server scope requires
   * `role.manage`; group/room scopes also accept effective `room.manage`.
   * Granting an elevated permission requires privileged mode.
   *
   * @example
   * // Deny pinning for moderators in one room.
   * await client.admin.permissions.setRolePermission('moderator', 'message.pin', 'deny', { roomId })
   */
  setRolePermission(
    roleName: string,
    permission: string,
    decision: PermissionDecisionInput,
    scope?: PermissionScopeInput,
  ): Promise<PermissionDecisionUpdate>
  setRolePermission(
    roleName: string,
    permissions: readonly string[],
    decision: PermissionDecisionInput,
    scope?: PermissionScopeInput,
  ): Promise<PermissionDecisionUpdate[]>
  async setRolePermission(
    roleName: string,
    permission: string | readonly string[],
    decision: PermissionDecisionInput,
    scope?: PermissionScopeInput,
  ): Promise<PermissionDecisionUpdate | PermissionDecisionUpdate[]> {
    return this.setMany('SetRolePermission', { roleName }, permission, decision, scope)
  }

  /**
   * Set a user's (or bot's) decision for one permission — or several, given
   * an array (sequential RPCs; stops at the first error) — at `scope`
   * (default: server). `'none'` clears the explicit decision.
   *
   * Human targets require `user.manage-permissions` (privileged mode for
   * human sessions). **Bots** start with no permissions; their matrix is an
   * allowlist: only `'allow'` and `'none'` are accepted (`'deny'` →
   * INVALID_ARGUMENT), the caller must own the bot or have `bot.manage`, and
   * a grant is only effective while the bot's owner also has the permission
   * at that scope. Granting an elevated permission needs privileged mode.
   *
   * Room membership alone doesn't let a bot read: grant `message.read` (or
   * `message.read-interactions`) plus `message.post` (or
   * `message.post-in-thread` / `message.post-in-interactions`). To let a bot
   * join rooms, grant `room.join` at server, group, or room scope.
   *
   * @example
   * // Let a freshly created bot read and post in DMs (e.g. with its owner),
   * // without any channel access. Its owner must have these at DM scope too.
   * const { bot } = await client.bots.create({ login: 'helper', displayName: 'Helper' })
   * await client.admin.permissions.setUserPermission(bot.user.id, ['message.read', 'message.post'], 'allow', 'dm')
   *
   * @example
   * // Let a bot post in one room; revoke later with 'none'.
   * await client.admin.permissions.setUserPermission(botId, ['message.read', 'message.post'], 'allow', { roomId })
   * await client.admin.permissions.setUserPermission(botId, 'message.post', 'none', { roomId })
   */
  setUserPermission(
    userId: string,
    permission: string,
    decision: PermissionDecisionInput,
    scope?: PermissionScopeInput,
  ): Promise<PermissionDecisionUpdate>
  setUserPermission(
    userId: string,
    permissions: readonly string[],
    decision: PermissionDecisionInput,
    scope?: PermissionScopeInput,
  ): Promise<PermissionDecisionUpdate[]>
  async setUserPermission(
    userId: string,
    permission: string | readonly string[],
    decision: PermissionDecisionInput,
    scope?: PermissionScopeInput,
  ): Promise<PermissionDecisionUpdate | PermissionDecisionUpdate[]> {
    return this.setMany('SetUserPermission', { userId }, permission, decision, scope)
  }

  private async setMany(
    method: 'SetRolePermission' | 'SetUserPermission',
    target: Record<string, string>,
    permission: string | readonly string[],
    decision: PermissionDecisionInput,
    scope?: PermissionScopeInput,
  ): Promise<PermissionDecisionUpdate | PermissionDecisionUpdate[]> {
    // Validate everything before the first write.
    const wireDecision = toPermissionDecision(decision)
    const wireScope = scopeField(scope)
    const list = typeof permission === 'string' ? [permission] : permission
    if (list.some(p => !p)) {
      throw new ChattoValidationError('empty_permission', 'Permission identifiers must not be empty')
    }
    const results: PermissionDecisionUpdate[] = []
    for (const p of list) {
      const res = await this.ctx.rest.post(
        SERVICE,
        method,
        { ...target, permission: p, decision: wireDecision, scope: wireScope },
        SetPermissionResponseSchema,
      )
      results.push(res.decision)
    }
    return typeof permission === 'string' ? results[0]! : results
  }
}

function checkLimit(limit?: number) {
  if (limit != null && limit > 100) {
    throw new ChattoValidationError('page_limit_too_large', 'At most 100 scopes may be listed per page')
  }
}

function toDecisionPage(res: {
  decisions: PermissionDecisionPage['decisions']
  scopes: PermissionScope[]
  page?: { totalCount: number; hasMore: boolean }
}): PermissionDecisionPage {
  return {
    decisions: res.decisions,
    scopes: res.scopes,
    totalCount: res.page?.totalCount ?? res.scopes.length,
    hasMore: res.page?.hasMore ?? false,
  }
}
