import { describe, it, expect, mock } from 'bun:test'
import { RoomInvitationManager } from '../../src/managers/room-invitations'
import { ChattoValidationError } from '../../src/errors'

const invitation = {
  id: 'I_1',
  roomId: 'R_1',
  senderId: 'U_1',
  recipientId: 'U_2',
  createdAt: '2026-11-10T00:00:00Z',
  expiresAt: '2026-11-17T00:00:00Z',
  status: 'ROOM_INVITATION_STATUS_PENDING',
  canAccept: true,
}

/**
 * Mock RestClient.post that, like the real client, parses the response with the
 * given schema. Responses are returned in order; the last one repeats.
 */
function parsingPost(...responses: unknown[]) {
  let call = 0
  return mock(async (_s: string, _m: string, _b: unknown, schema: any) =>
    schema.parse(responses[Math.min(call++, responses.length - 1)]),
  )
}

function makeCtx(...responses: unknown[]) {
  return { rest: { post: parsingPost(...responses) } } as any
}

function expectCall(ctx: any, method: string, body: unknown) {
  expect(ctx.rest.post).toHaveBeenCalledWith('chatto.api.v1.RoomInvitationService', method, body, expect.anything())
}

describe('RoomInvitationManager', () => {
  it('.create() calls CreateRoomInvitation', async () => {
    const ctx = makeCtx({ invitation })
    const inv = await new RoomInvitationManager(ctx).create('R_1', 'U_2')
    expectCall(ctx, 'CreateRoomInvitation', { roomId: 'R_1', recipientId: 'U_2' })
    expect(inv).toEqual(invitation as any)
  })

  it('.fetch() calls GetRoomInvitation and defaults omitted fields', async () => {
    const ctx = makeCtx({ invitation: { id: 'I_2' } })
    const inv = await new RoomInvitationManager(ctx).fetch('I_2')
    expectCall(ctx, 'GetRoomInvitation', { invitationId: 'I_2' })
    expect(inv).toEqual({
      id: 'I_2',
      roomId: '',
      senderId: '',
      recipientId: '',
      status: 'ROOM_INVITATION_STATUS_UNSPECIFIED',
      canAccept: false,
    })
  })

  it('.fetchMany() calls BatchGetRoomInvitations, short-circuits and validates', async () => {
    const ctx = makeCtx({ invitations: [invitation] })
    const m = new RoomInvitationManager(ctx)
    expect(await m.fetchMany([])).toEqual([])
    expect(ctx.rest.post).not.toHaveBeenCalled()
    expect(await m.fetchMany(['I_1'])).toHaveLength(1)
    expectCall(ctx, 'BatchGetRoomInvitations', { invitationIds: ['I_1'] })
    await expect(m.fetchMany(Array(101).fill('i'))).rejects.toBeInstanceOf(ChattoValidationError)
    expect(await new RoomInvitationManager(makeCtx({})).fetchMany(['x'])).toEqual([])
  })

  it('.list() sends filters and returns a page', async () => {
    const ctx = makeCtx({ invitations: [invitation], page: { totalCount: '3', hasMore: true } })
    const page = await new RoomInvitationManager(ctx).list({ sent: true, pendingOnly: true, limit: 1 })
    expectCall(ctx, 'ListRoomInvitations', { page: { limit: 1, offset: undefined }, sent: true, pendingOnly: true })
    expect(page.totalCount).toBe(3)
    expect(page.hasMore).toBe(true)
    const empty = await new RoomInvitationManager(makeCtx({ page: {} })).list()
    expect(empty).toEqual({ items: [], totalCount: 0, hasMore: false })
  })

  it('.accept() / .decline()', async () => {
    const ctx = makeCtx({ invitation: { ...invitation, status: 'ROOM_INVITATION_STATUS_ACCEPTED' } })
    const m = new RoomInvitationManager(ctx)
    expect((await m.accept('I_1')).status).toBe('ROOM_INVITATION_STATUS_ACCEPTED')
    expectCall(ctx, 'AcceptRoomInvitation', { invitationId: 'I_1' })
    await m.decline('I_1')
    expectCall(ctx, 'DeclineRoomInvitation', { invitationId: 'I_1' })
  })

  it('maps unknown statuses to UNSPECIFIED', async () => {
    const inv = await new RoomInvitationManager(makeCtx({ invitation: { id: 'I', status: 'ROOM_INVITATION_STATUS_NEW' } })).fetch('I')
    expect(inv.status).toBe('ROOM_INVITATION_STATUS_UNSPECIFIED')
  })
})
