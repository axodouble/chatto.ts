import type { ClientContext } from '../../context'
import { GetSystemInfoResponseSchema, type AdminSystemInfoReport } from '../../schemas/admin/diagnostics'

/** Server diagnostics for the admin system page (`chatto.admin.v1.AdminDiagnosticsService`). */
export class AdminDiagnosticsManager {
  constructor(private readonly ctx: ClientContext) {}

  /**
   * Broker/JetStream state, projection health, durable workers, asset cleanup
   * and LiveKit setup. Requires the server **owner** role (privileged mode for
   * human sessions — `client.viewer.activatePrivilegedMode()`). Checks the
   * LiveKit API live, so it can take up to ~5 s when LiveKit doesn't reply.
   */
  async getSystemInfo(): Promise<AdminSystemInfoReport> {
    return this.ctx.rest.post('chatto.admin.v1.AdminDiagnosticsService', 'GetSystemInfo', {}, GetSystemInfoResponseSchema)
  }
}
