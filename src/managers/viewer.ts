import type { ClientContext } from '../context'
import {
  GetViewerResponseSchema,
  PrivilegedModeResponseSchema,
  type Viewer,
  type PrivilegedModeResult,
} from '../schemas/viewer'

const SERVICE = 'chatto.api.v1.ViewerService'

/** Authenticated viewer snapshot and privileged mode (`chatto.api.v1.ViewerService`). */
export class ViewerManager {
  constructor(private readonly ctx: ClientContext) {}

  /**
   * Fetch the authenticated viewer: own profile, settings, account-action
   * availability, capabilities, server permission decisions and privileged-mode state.
   */
  async fetch(): Promise<Viewer> {
    return this.ctx.rest.post(SERVICE, 'GetViewer', {}, GetViewerResponseSchema)
  }

  /**
   * Activate all entitled elevation-required permissions for a fixed window.
   * FAILED_PRECONDITION for bots or callers with no eligible entitlement.
   */
  async activatePrivilegedMode(): Promise<PrivilegedModeResult> {
    return this.ctx.rest.post(SERVICE, 'ActivatePrivilegedMode', {}, PrivilegedModeResponseSchema)
  }

  /** Drop elevated permissions immediately. FAILED_PRECONDITION for bots. */
  async deactivatePrivilegedMode(): Promise<PrivilegedModeResult> {
    return this.ctx.rest.post(SERVICE, 'DeactivatePrivilegedMode', {}, PrivilegedModeResponseSchema)
  }
}
