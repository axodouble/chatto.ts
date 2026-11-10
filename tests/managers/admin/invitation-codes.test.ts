import { describe, it, expect, mock } from 'bun:test'
import { AdminInvitationCodeManager } from '../../../src/managers/admin/invitation-codes'
import { ChattoValidationError } from '../../../src/errors'

const SVC = 'chatto.admin.v1.AdminInvitationCodeService'

// The mock runs the real Zod schema (4th arg), like RestClient does, so the
// tests exercise proto3 default handling.
function makeCtx(postReturn: unknown) {
  const ctx: any = { rest: {}, reply: postReturn }
  ctx.rest.post = mock(async (_s: string, _m: string, _b: unknown, schema: any) => schema.parse(ctx.reply))
  return ctx
}
function setReply(ctx: any, value: unknown) {
  ctx.reply = value
}
function lastCall(ctx: any) {
  return ctx.rest.post.mock.calls.at(-1)
}

// Captured from a live Chatto 0.5.0 server.
const codeWire = {
  id: 'ILQKqcimtQhv1g8', code: 'R4NV-FWAW-AWIS-LQTG-EVUQ', createdBy: 'U_owner',
  createdAt: '2026-11-10T00:32:50.330549327Z', expiresAt: '2026-11-17T00:32:50.330549327Z',
  status: 'INVITATION_CODE_STATUS_ACTIVE', note: 'sdk probe',
}

describe('AdminInvitationCodeManager', () => {
  it('list() pages codes; empty server answers { page: {} }', async () => {
    const ctx = makeCtx({ invitationCodes: [codeWire], page: { totalCount: '1' } })
    const m = new AdminInvitationCodeManager(ctx)
    const page = await m.list({ limit: 5, offset: 0 })
    expect(lastCall(ctx).slice(0, 3)).toEqual([SVC, 'ListInvitationCodes', { page: { limit: 5, offset: 0 } }])
    expect(page.items[0]!.status).toBe('INVITATION_CODE_STATUS_ACTIVE')
    setReply(ctx, { page: {} })
    expect(await m.list()).toEqual({ items: [], totalCount: 0, hasMore: false })
    expect(lastCall(ctx)[2]).toEqual({ page: undefined })
    await expect(m.list({ limit: 101 })).rejects.toBeInstanceOf(ChattoValidationError)
  })

  it('fetch() defaults omitted fields', async () => {
    const ctx = makeCtx({ invitationCode: { id: 'I1' } })
    const code = await new AdminInvitationCodeManager(ctx).fetch('I1')
    expect(lastCall(ctx).slice(0, 3)).toEqual([SVC, 'GetInvitationCode', { id: 'I1' }])
    expect(code).toEqual({ id: 'I1', code: '', createdBy: '', status: 'INVITATION_CODE_STATUS_UNSPECIFIED', note: '' })
  })

  it('create() sends the note and validates its length', async () => {
    const ctx = makeCtx({ invitationCode: codeWire })
    const m = new AdminInvitationCodeManager(ctx)
    expect((await m.create({ note: 'sdk probe' })).code).toBe('R4NV-FWAW-AWIS-LQTG-EVUQ')
    expect(lastCall(ctx).slice(0, 3)).toEqual([SVC, 'CreateInvitationCode', { note: 'sdk probe' }])
    await m.create()
    expect(lastCall(ctx)[2]).toEqual({ note: undefined })
    await expect(m.create({ note: 'x'.repeat(251) })).rejects.toBeInstanceOf(ChattoValidationError)
  })

  it('revoke() returns the revoked code', async () => {
    const ctx = makeCtx({ invitationCode: { ...codeWire, status: 'INVITATION_CODE_STATUS_REVOKED', revokedAt: '2026-11-10T00:32:50.344658575Z' } })
    const code = await new AdminInvitationCodeManager(ctx).revoke('ILQKqcimtQhv1g8')
    expect(lastCall(ctx).slice(0, 3)).toEqual([SVC, 'RevokeInvitationCode', { id: 'ILQKqcimtQhv1g8' }])
    expect(code.status).toBe('INVITATION_CODE_STATUS_REVOKED')
    expect(code.revokedAt).toBe('2026-11-10T00:32:50.344658575Z')
  })
})
