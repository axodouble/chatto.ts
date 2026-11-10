import type { ClientContext } from '../context'
import { ChattoValidationError } from '../errors'
import { pageRequest, toPage, type Page, type PageOptions } from '../util/page'
import {
  RoomInvitationResponseSchema,
  BatchGetRoomInvitationsResponseSchema,
  ListRoomInvitationsResponseSchema,
  type RoomInvitation,
} from '../schemas/room-invitation'

const SERVICE = 'chatto.api.v1.RoomInvitationService'

export interface ListRoomInvitationsOptions extends PageOptions {
  /** List invitations the caller sent instead of ones it received. */
  sent?: boolean
  /** Only unexpired pending invitations. */
  pendingOnly?: boolean
}

/**
 * Room invitations (`RoomInvitationService`). Invitations grant membership only
 * after the recipient accepts them; each is visible only to its sender and recipient.
 */
export class RoomInvitationManager {
  constructor(private readonly ctx: ClientContext) {}

  /**
   * Invites a user to a room. Requires room membership and `room.invite`. A
   * duplicate from the same sender returns the existing pending invitation; a
   * pending invitation from a different sender is rejected.
   */
  async create(roomId: string, recipientId: string): Promise<RoomInvitation> {
    const res = await this.ctx.rest.post(
      SERVICE,
      'CreateRoomInvitation',
      { roomId, recipientId },
      RoomInvitationResponseSchema,
    )
    return res.invitation
  }

  /** Fetches one invitation. NOT_FOUND for absent or inaccessible invitations. */
  async fetch(invitationId: string): Promise<RoomInvitation> {
    const res = await this.ctx.rest.post(SERVICE, 'GetRoomInvitation', { invitationId }, RoomInvitationResponseSchema)
    return res.invitation
  }

  /** Fetches up to 100 invitations; absent and inaccessible ones are omitted. */
  async fetchMany(invitationIds: string[]): Promise<RoomInvitation[]> {
    if (invitationIds.length === 0) return []
    if (invitationIds.length > 100) {
      throw new ChattoValidationError('too_many_invitation_ids', 'At most 100 invitation IDs may be fetched at once')
    }
    const res = await this.ctx.rest.post(
      SERVICE,
      'BatchGetRoomInvitations',
      { invitationIds },
      BatchGetRoomInvitationsResponseSchema,
    )
    return res.invitations
  }

  /** Lists the caller's received (default) or sent invitations, newest first. Default 50, max 100 per page. */
  async list(opts: ListRoomInvitationsOptions = {}): Promise<Page<RoomInvitation>> {
    const res = await this.ctx.rest.post(
      SERVICE,
      'ListRoomInvitations',
      { page: pageRequest(opts), sent: opts.sent || undefined, pendingOnly: opts.pendingOnly || undefined },
      ListRoomInvitationsResponseSchema,
    )
    return toPage(res.invitations, res.page)
  }

  /** Accepts an invitation (recipient only). Joins the room, bypassing only `room.join`. */
  async accept(invitationId: string): Promise<RoomInvitation> {
    const res = await this.ctx.rest.post(SERVICE, 'AcceptRoomInvitation', { invitationId }, RoomInvitationResponseSchema)
    return res.invitation
  }

  /** Declines an invitation (recipient only). Does not change membership. */
  async decline(invitationId: string): Promise<RoomInvitation> {
    const res = await this.ctx.rest.post(SERVICE, 'DeclineRoomInvitation', { invitationId }, RoomInvitationResponseSchema)
    return res.invitation
  }
}
