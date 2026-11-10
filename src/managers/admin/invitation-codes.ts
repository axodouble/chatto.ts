import type { ClientContext } from '../../context'
import { ChattoValidationError } from '../../errors'
import { type Page, type PageOptions, pageRequest, toPage } from '../../util/page'
import {
  ListInvitationCodesResponseSchema,
  InvitationCodeResponseSchema,
  type InvitationCode,
} from '../../schemas/admin/invitation-codes'

const SERVICE = 'chatto.admin.v1.AdminInvitationCodeService'

/**
 * Single-use registration codes for invite-only servers
 * (`chatto.admin.v1.AdminInvitationCodeService`). `user.invite` gives access to
 * your own codes; `user.manage-invites` to all codes (needs privileged mode for
 * human sessions — `client.viewer.activatePrivilegedMode()`). Codes are
 * secrets: never log `code`.
 */
export class AdminInvitationCodeManager {
  constructor(private readonly ctx: ClientContext) {}

  /** Visible current and historical codes, newest first (default 20, max 100 per page). */
  async list(opts: PageOptions = {}): Promise<Page<InvitationCode>> {
    if (opts.limit != null && opts.limit > 100) {
      throw new ChattoValidationError('page_limit_too_large', 'At most 100 invitation codes may be listed per page')
    }
    const res = await this.ctx.rest.post(
      SERVICE,
      'ListInvitationCodes',
      { page: pageRequest(opts) },
      ListInvitationCodesResponseSchema,
    )
    return toPage(res.invitationCodes, res.page)
  }

  /** Read one code by ID. NOT_FOUND for unknown or inaccessible IDs. */
  async fetch(id: string): Promise<InvitationCode> {
    const res = await this.ctx.rest.post(SERVICE, 'GetInvitationCode', { id }, InvitationCodeResponseSchema)
    return res.invitationCode
  }

  /**
   * Create a single-use code that expires seven days after creation. The
   * optional `note` (max 250 chars, trimmed) is visible to the creator and
   * invitation managers and does not bind the code to anyone. Not idempotent.
   */
  async create(opts: { note?: string } = {}): Promise<InvitationCode> {
    if (opts.note != null && [...opts.note].length > 250) {
      throw new ChattoValidationError('note_too_long', 'Invitation code note must be at most 250 characters')
    }
    const res = await this.ctx.rest.post(
      SERVICE,
      'CreateInvitationCode',
      { note: opts.note || undefined },
      InvitationCodeResponseSchema,
    )
    return res.invitationCode
  }

  /** Revoke a code (history is kept; repeating is safe). NOT_FOUND for unknown/inaccessible IDs. */
  async revoke(id: string): Promise<InvitationCode> {
    const res = await this.ctx.rest.post(SERVICE, 'RevokeInvitationCode', { id }, InvitationCodeResponseSchema)
    return res.invitationCode
  }
}
