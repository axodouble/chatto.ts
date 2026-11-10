import type { ClientContext } from '../../context'
import { AdminUserManager } from './users'
import { AdminPermissionManager } from './permissions'
import { AdminRoleManager } from './roles'
import { AdminInvitationCodeManager } from './invitation-codes'
import { AdminOAuthClientManager } from './oauth-clients'
import { AdminDiagnosticsManager } from './diagnostics'
import { AdminEventLogManager } from './event-log'
import { AdminRoomLayoutManager } from './room-layout'
import { AdminServerManager } from './server'

/**
 * The `chatto.admin.v1` API. Most calls need an administrative permission
 * that is only active in privileged mode: call
 * `client.viewer.activatePrivilegedMode()` first (it lasts 15 minutes).
 */
export class AdminManager {
  /** Members: roles, deactivation, deletion, passwords. */
  readonly users: AdminUserManager
  /** Role and user (including bot) permission matrices and grants. */
  readonly permissions: AdminPermissionManager
  readonly roles: AdminRoleManager
  readonly invitationCodes: AdminInvitationCodeManager
  readonly oauthClients: AdminOAuthClientManager
  readonly diagnostics: AdminDiagnosticsManager
  readonly eventLog: AdminEventLogManager
  /** Room groups, sidebar links, and room placement. */
  readonly roomLayout: AdminRoomLayoutManager
  /** Server configuration, logo/banner, blocked usernames, neighbors. */
  readonly server: AdminServerManager

  constructor(ctx: ClientContext) {
    this.users = new AdminUserManager(ctx)
    this.permissions = new AdminPermissionManager(ctx)
    this.roles = new AdminRoleManager(ctx)
    this.invitationCodes = new AdminInvitationCodeManager(ctx)
    this.oauthClients = new AdminOAuthClientManager(ctx)
    this.diagnostics = new AdminDiagnosticsManager(ctx)
    this.eventLog = new AdminEventLogManager(ctx)
    this.roomLayout = new AdminRoomLayoutManager(ctx)
    this.server = new AdminServerManager(ctx)
  }
}
