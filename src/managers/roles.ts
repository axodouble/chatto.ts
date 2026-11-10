import type { ClientContext } from '../context'
import { ChattoValidationError } from '../errors'
import { RolesResponseSchema, GetRoleResponseSchema, type Role } from '../schemas/role'

const SERVICE = 'chatto.api.v1.RoleService'

/** Public role metadata (`chatto.api.v1.RoleService`). */
export class RoleManager {
  constructor(private readonly ctx: ClientContext) {}

  /** List the role catalog, sorted by position. */
  async list(): Promise<Role[]> {
    const res = await this.ctx.rest.post(SERVICE, 'ListRoles', {}, RolesResponseSchema)
    return res.roles
  }

  /** Fetch one role by its stable name (e.g. `'admin'`). NOT_FOUND when unknown. */
  async fetch(name: string): Promise<Role> {
    const res = await this.ctx.rest.post(SERVICE, 'GetRole', { name }, GetRoleResponseSchema)
    return res.role
  }

  /**
   * Fetch up to 100 roles by name. Unknown names are omitted; first-seen order,
   * de-duplicated. Empty input returns `[]`.
   */
  async batchFetch(names: string[]): Promise<Role[]> {
    if (names.length === 0) return []
    if (names.length > 100) {
      throw new ChattoValidationError('too_many_role_names', 'At most 100 role names may be fetched at once')
    }
    const res = await this.ctx.rest.post(SERVICE, 'BatchGetRoles', { names }, RolesResponseSchema)
    return res.roles
  }
}
