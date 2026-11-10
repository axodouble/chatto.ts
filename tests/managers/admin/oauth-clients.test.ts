import { describe, it, expect, mock } from 'bun:test'
import { AdminOAuthClientManager } from '../../../src/managers/admin/oauth-clients'
import { ChattoValidationError } from '../../../src/errors'

const SVC = 'chatto.admin.v1.AdminOAuthClientService'

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

const clientWire = {
  clientId: 'https://app.example.com/oauth/client.json',
  clientName: 'Example', clientOrigin: 'https://app.example.com',
  source: 'OAUTH_CLIENT_SOURCE_CIMD', policy: 'OAUTH_CLIENT_POLICY_TRUSTED',
  firstAuthorizationAt: '2026-11-01T00:00:00Z', lastAuthorizationAt: '2026-11-09T00:00:00Z',
  redirectOrigins: ['https://app.example.com'], authorizedUserCount: 3,
}

describe('AdminOAuthClientManager', () => {
  it('list() pages clients; empty server answers { page: {} }', async () => {
    const ctx = makeCtx({ oauthClients: [clientWire], page: { totalCount: '1' } })
    const m = new AdminOAuthClientManager(ctx)
    const page = await m.list({ limit: 10 })
    expect(lastCall(ctx).slice(0, 3)).toEqual([SVC, 'ListOAuthClients', { page: { limit: 10, offset: undefined } }])
    expect(page.items[0]!.authorizedUserCount).toBe(3)
    setReply(ctx, { page: {} })
    expect(await m.list()).toEqual({ items: [], totalCount: 0, hasMore: false })
    await expect(m.list({ limit: 101 })).rejects.toBeInstanceOf(ChattoValidationError)
  })

  it('fetch() defaults omitted fields and validates the client ID', async () => {
    const ctx = makeCtx({ oauthClient: { clientId: 'chatto:desktop' } })
    const m = new AdminOAuthClientManager(ctx)
    const c = await m.fetch('chatto:desktop')
    expect(lastCall(ctx).slice(0, 3)).toEqual([SVC, 'GetOAuthClient', { clientId: 'chatto:desktop' }])
    expect(c).toEqual({
      clientId: 'chatto:desktop', clientName: '', clientOrigin: '', source: 'OAUTH_CLIENT_SOURCE_UNSPECIFIED',
      policy: 'OAUTH_CLIENT_POLICY_UNSPECIFIED', redirectOrigins: [], authorizedUserCount: 0,
    })
    await expect(m.fetch('')).rejects.toBeInstanceOf(ChattoValidationError)
    await expect(m.fetch('x'.repeat(2049))).rejects.toBeInstanceOf(ChattoValidationError)
  })

  it('setPolicy() maps friendly names and sends the mask', async () => {
    const ctx = makeCtx({ oauthClient: { ...clientWire, policy: 'OAUTH_CLIENT_POLICY_BLOCKED' } })
    const m = new AdminOAuthClientManager(ctx)
    expect((await m.setPolicy(clientWire.clientId, 'blocked')).policy).toBe('OAUTH_CLIENT_POLICY_BLOCKED')
    expect(lastCall(ctx).slice(0, 3)).toEqual([
      SVC, 'UpdateOAuthClientPolicy', { clientId: clientWire.clientId, policy: 'OAUTH_CLIENT_POLICY_BLOCKED', updateMask: 'policy' },
    ])
    await m.setPolicy(clientWire.clientId, 'OAUTH_CLIENT_POLICY_DEFAULT')
    expect(lastCall(ctx)[2].policy).toBe('OAUTH_CLIENT_POLICY_DEFAULT')
    await expect(m.setPolicy(clientWire.clientId, 'OAUTH_CLIENT_POLICY_UNSPECIFIED')).rejects.toBeInstanceOf(ChattoValidationError)
    await expect(m.setPolicy(clientWire.clientId, 'nope' as any)).rejects.toBeInstanceOf(ChattoValidationError)
  })
})
