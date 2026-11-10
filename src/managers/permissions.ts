import type { ClientContext } from '../context'
import { ListEffectivePermissionsResponseSchema, type EffectivePermission } from '../schemas/permission'

/** Read-only effective authority (`chatto.api.v1.PermissionService`). */
export class PermissionManager {
  constructor(private readonly ctx: ClientContext) {}

  /**
   * List every permission currently allowed for a user, per scope (server,
   * group, room, DM). Any member may read a bot's permissions; human targets
   * (including yourself) require `user.manage-permissions`. Denied permissions
   * are absent. NOT_FOUND for missing/deleted users.
   */
  async listEffective(userId: string): Promise<EffectivePermission[]> {
    const res = await this.ctx.rest.post(
      'chatto.api.v1.PermissionService',
      'ListEffectivePermissions',
      { userId },
      ListEffectivePermissionsResponseSchema,
    )
    return res.permissions
  }
}
