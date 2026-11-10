import type { ClientContext } from '../../context'
import { ChattoValidationError } from '../../errors'
import { type Page, type PageOptions, pageRequest, toPage } from '../../util/page'
import {
  OAUTH_CLIENT_POLICIES,
  ListOAuthClientsResponseSchema,
  OAuthClientResponseSchema,
  type OAuthClient,
  type OAuthClientPolicy,
} from '../../schemas/admin/oauth-clients'

const SERVICE = 'chatto.admin.v1.AdminOAuthClientService'

/**
 * `'default'` removes any label, `'trusted'` is an informational blessing
 * (never bypasses user consent), `'blocked'` stops authorization and revokes
 * the client's tokens. Raw `OAUTH_CLIENT_POLICY_*` names are accepted too.
 */
export type OAuthClientPolicyInput = 'default' | 'trusted' | 'blocked' | OAuthClientPolicy

const FRIENDLY_POLICIES: Record<string, OAuthClientPolicy> = {
  default: 'OAUTH_CLIENT_POLICY_DEFAULT',
  trusted: 'OAUTH_CLIENT_POLICY_TRUSTED',
  blocked: 'OAUTH_CLIENT_POLICY_BLOCKED',
}

/**
 * OAuth clients that completed at least one user authorization on this server
 * (`chatto.admin.v1.AdminOAuthClientService`). Requires `server.manage`
 * (privileged mode for human sessions — `client.viewer.activatePrivilegedMode()`).
 */
export class AdminOAuthClientManager {
  constructor(private readonly ctx: ClientContext) {}

  /** Clients in first-authorization order, oldest first (default 20, max 100 per page). */
  async list(opts: PageOptions = {}): Promise<Page<OAuthClient>> {
    if (opts.limit != null && opts.limit > 100) {
      throw new ChattoValidationError('page_limit_too_large', 'At most 100 OAuth clients may be listed per page')
    }
    const res = await this.ctx.rest.post(
      SERVICE,
      'ListOAuthClients',
      { page: pageRequest(opts) },
      ListOAuthClientsResponseSchema,
    )
    return toPage(res.oauthClients, res.page)
  }

  /** One client by its exact client ID (CIMD URL or built-in URI). NOT_FOUND when unrecorded. */
  async fetch(clientId: string): Promise<OAuthClient> {
    checkClientId(clientId)
    const res = await this.ctx.rest.post(SERVICE, 'GetOAuthClient', { clientId }, OAuthClientResponseSchema)
    return res.oauthClient
  }

  /** Replace a client's policy. Blocking revokes its existing tokens. Returns the updated client. */
  async setPolicy(clientId: string, policy: OAuthClientPolicyInput): Promise<OAuthClient> {
    checkClientId(clientId)
    const wire = FRIENDLY_POLICIES[policy] ?? policy
    if (wire === 'OAUTH_CLIENT_POLICY_UNSPECIFIED' || !(OAUTH_CLIENT_POLICIES as readonly string[]).includes(wire)) {
      throw new ChattoValidationError('invalid_oauth_client_policy', `Invalid OAuth client policy: ${policy}`)
    }
    const res = await this.ctx.rest.post(
      SERVICE,
      'UpdateOAuthClientPolicy',
      { clientId, policy: wire, updateMask: 'policy' },
      OAuthClientResponseSchema,
    )
    return res.oauthClient
  }
}

function checkClientId(clientId: string) {
  if (!clientId || clientId.length > 2048) {
    throw new ChattoValidationError('invalid_client_id', 'OAuth client ID must be 1–2048 characters')
  }
}
