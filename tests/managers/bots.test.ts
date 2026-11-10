import { describe, it, expect, mock } from 'bun:test'
import { BotManager } from '../../src/managers/bots'
import { ChattoValidationError } from '../../src/errors'

const SVC = 'chatto.api.v1.BotService'

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

// Shapes captured from a live Chatto 0.5.0 server.
const botWire = {
  user: {
    id: 'UVYroD032LgRpHZ', login: 'probe', displayName: 'Probe',
    presenceStatus: 'PRESENCE_STATUS_OFFLINE', bot: { ownerUserId: 'U_owner' },
  },
  ownerUserId: 'U_owner',
  createdAt: '2026-11-10T00:19:01.258018001Z',
  apiKeyCreatedAt: '2026-11-10T00:19:01.258018001Z',
  incomingWebhooks: [{ id: 'W_in', name: 'hook', createdAt: 't', lastUsedState: 'CREDENTIAL_LAST_USED_STATE_NO_USE_RECORDED' }],
  // The legacy initial key omits lastUsedState (enum 0).
  apiKeys: [{ id: 'legacy', name: 'Default key', createdAt: 't' }],
}
// proto3 JSON omits every zero field.
const minimalBot = { user: { id: 'U_bot' } }

const outboundWire = {
  id: 'W_out', enabled: true, hasAuthorization: true, url: 'https://example.com/hook', name: 'out', createdAt: 't',
}

describe('BotManager', () => {
  it('list() sends search + page and returns a Page', async () => {
    const ctx = makeCtx({ bots: [botWire], page: { totalCount: '1' } })
    const page = await new BotManager(ctx).list({ search: 'pro', limit: 5, offset: 0 })
    expect(lastCall(ctx).slice(0, 3)).toEqual([SVC, 'ListBots', { search: 'pro', page: { limit: 5, offset: 0 } }])
    expect(page.totalCount).toBe(1)
    expect(page.hasMore).toBe(false)
    expect(page.items[0]!.apiKeys[0]!.lastUsedState).toBe('CREDENTIAL_LAST_USED_STATE_UNSPECIFIED')
    expect(page.items[0]!.incomingWebhooks[0]!.lastUsedState).toBe('CREDENTIAL_LAST_USED_STATE_NO_USE_RECORDED')
  })

  it('list() handles an empty `{ page: {} }` response and enforces limit <= 100', async () => {
    const ctx = makeCtx({ page: {} })
    const page = await new BotManager(ctx).list()
    expect(lastCall(ctx)[2]).toEqual({ search: undefined, page: undefined })
    expect(page).toEqual({ items: [], totalCount: 0, hasMore: false })
    await expect(new BotManager(ctx).list({ limit: 101 })).rejects.toBeInstanceOf(ChattoValidationError)
  })

  it('fetch() calls GetBot and applies defaults to a minimal bot', async () => {
    const ctx = makeCtx({ bot: minimalBot })
    const bot = await new BotManager(ctx).fetch('U_bot')
    expect(lastCall(ctx).slice(0, 3)).toEqual([SVC, 'GetBot', { botUserId: 'U_bot' }])
    expect(bot.ownerUserId).toBe('')
    expect(bot.apiKeys).toEqual([])
    expect(bot.incomingWebhooks).toEqual([])
    expect(bot.user.login).toBe('')
  })

  it('fetchMany() short-circuits on [] and rejects > 100 ids', async () => {
    const ctx = makeCtx({})
    const m = new BotManager(ctx)
    expect(await m.fetchMany([])).toEqual([])
    expect(ctx.rest.post).not.toHaveBeenCalled()
    await expect(m.fetchMany(Array.from({ length: 101 }, (_, i) => `U_${i}`))).rejects.toBeInstanceOf(ChattoValidationError)
    expect(await m.fetchMany(['U_1'])).toEqual([])
    expect(lastCall(ctx).slice(0, 3)).toEqual([SVC, 'BatchGetBots', { botUserIds: ['U_1'] }])
  })

  it('create() returns the show-once api key', async () => {
    const ctx = makeCtx({
      bot: botWire, apiKey: 'cht_BK_UVYroD032LgRpHZ.secret',
      apiKeyMetadata: { id: 'legacy', name: 'Default key', createdAt: 't' },
    })
    const created = await new BotManager(ctx).create({ login: 'probe', displayName: 'Probe' })
    expect(lastCall(ctx).slice(0, 3)).toEqual([SVC, 'CreateBot', { login: 'probe', displayName: 'Probe', apiKeyName: undefined }])
    expect(created.apiKey).toBe('cht_BK_UVYroD032LgRpHZ.secret')
    expect(created.apiKeyMetadata.id).toBe('legacy')
    expect(created.bot.user.id).toBe('UVYroD032LgRpHZ')
  })

  it('delete() returns the deleted flag, defaulting to false', async () => {
    const ctx = makeCtx({ deleted: true })
    expect(await new BotManager(ctx).delete('U_bot')).toBe(true)
    expect(lastCall(ctx).slice(0, 3)).toEqual([SVC, 'DeleteBot', { botUserId: 'U_bot' }])
    expect(await new BotManager(makeCtx({})).delete('U_bot')).toBe(false)
  })

  it('createApiKey() / revokeApiKey()', async () => {
    const ctx = makeCtx({
      bot: botWire, apiKey: 'cht_BK_x.y',
      apiKeyMetadata: { id: 'K_2', name: 'second', createdAt: 't', lastUsedState: 'CREDENTIAL_LAST_USED_STATE_NO_USE_RECORDED' },
    })
    const m = new BotManager(ctx)
    const issued = await m.createApiKey('U_bot', 'second')
    expect(lastCall(ctx).slice(0, 3)).toEqual([SVC, 'CreateBotApiKey', { botUserId: 'U_bot', name: 'second' }])
    expect(issued.apiKey).toBe('cht_BK_x.y')

    setReply(ctx, { bot: minimalBot })
    const bot = await m.revokeApiKey('U_bot', 'K_2')
    expect(lastCall(ctx).slice(0, 3)).toEqual([SVC, 'RevokeBotApiKey', { botUserId: 'U_bot', keyId: 'K_2' }])
    expect(bot.apiKeys).toEqual([])
  })

  it('createIncomingWebhook() / revokeIncomingWebhook()', async () => {
    const ctx = makeCtx({ bot: botWire, webhookUrl: 'http://localhost:4000/webhooks/incoming/cht_IW_x' })
    const m = new BotManager(ctx)
    const created = await m.createIncomingWebhook('U_bot', 'hook')
    expect(lastCall(ctx).slice(0, 3)).toEqual([SVC, 'CreateBotIncomingWebhook', { botUserId: 'U_bot', name: 'hook' }])
    expect(created.webhookUrl).toContain('/webhooks/incoming/')

    setReply(ctx, { bot: minimalBot })
    await m.revokeIncomingWebhook('U_bot', 'W_in')
    expect(lastCall(ctx).slice(0, 3)).toEqual([SVC, 'RevokeBotIncomingWebhook', { botUserId: 'U_bot', webhookId: 'W_in' }])
  })

  it('reassignOwner()', async () => {
    const ctx = makeCtx({ bot: { ...minimalBot, ownerUserId: 'U_new' } })
    const bot = await new BotManager(ctx).reassignOwner('U_bot', 'U_new')
    expect(lastCall(ctx).slice(0, 3)).toEqual([SVC, 'ReassignBotOwner', { botUserId: 'U_bot', ownerUserId: 'U_new' }])
    expect(bot.ownerUserId).toBe('U_new')
  })

  it('listOutboundWebhooks() / fetchOutboundWebhook() with defaults', async () => {
    const ctx = makeCtx({})
    const m = new BotManager(ctx)
    expect(await m.listOutboundWebhooks('U_bot')).toEqual([])
    expect(lastCall(ctx).slice(0, 3)).toEqual([SVC, 'ListBotOutboundWebhooks', { botUserId: 'U_bot' }])

    setReply(ctx, { webhook: { id: 'W_out', url: 'https://x', name: 'out' } })
    const hook = await m.fetchOutboundWebhook('U_bot', 'W_out')
    expect(lastCall(ctx).slice(0, 3)).toEqual([SVC, 'GetBotOutboundWebhook', { botUserId: 'U_bot', webhookId: 'W_out' }])
    expect(hook.enabled).toBe(false)
    expect(hook.hasAuthorization).toBe(false)
    expect(hook.latestFailure).toBeUndefined()
  })

  it('createOutboundWebhook() defaults to enabled and returns the signing secret', async () => {
    const ctx = makeCtx({ webhook: { id: 'W_out', url: 'https://example.com/hook', name: 'out' }, signingSecret: 'sec' })
    const m = new BotManager(ctx)
    const created = await m.createOutboundWebhook('U_bot', { name: 'out', url: 'https://example.com/hook' })
    expect(lastCall(ctx).slice(0, 3)).toEqual([SVC, 'CreateBotOutboundWebhook', {
      botUserId: 'U_bot', name: 'out', url: 'https://example.com/hook', authorization: undefined, enabled: true,
    }])
    expect(created.signingSecret).toBe('sec')
    await m.createOutboundWebhook('U_bot', { name: 'o', url: 'https://x', enabled: false, authorization: 'Bearer t' })
    expect(lastCall(ctx)[2]).toMatchObject({ enabled: false, authorization: 'Bearer t' })
  })

  it('updateOutboundWebhook() builds the field mask from given keys', async () => {
    const ctx = makeCtx({ webhook: outboundWire })
    const m = new BotManager(ctx)
    const hook = await m.updateOutboundWebhook('U_bot', 'W_out', { enabled: false, authorization: 'Bearer x' })
    expect(lastCall(ctx).slice(0, 3)).toEqual([SVC, 'UpdateBotOutboundWebhook', {
      botUserId: 'U_bot', webhookId: 'W_out', enabled: false, authorization: 'Bearer x', updateMask: 'enabled,authorization',
    }])
    expect(hook.hasAuthorization).toBe(true)

    // null clears the Authorization header: selected in the mask, value absent.
    await m.updateOutboundWebhook('U_bot', 'W_out', { authorization: null, url: 'https://y' })
    expect(lastCall(ctx)[2]).toEqual({ botUserId: 'U_bot', webhookId: 'W_out', url: 'https://y', updateMask: 'url,authorization' })

    await expect(m.updateOutboundWebhook('U_bot', 'W_out', {})).rejects.toBeInstanceOf(ChattoValidationError)
  })

  it('revokeOutboundWebhook() accepts the empty response', async () => {
    const ctx = makeCtx({})
    await new BotManager(ctx).revokeOutboundWebhook('U_bot', 'W_out')
    expect(lastCall(ctx).slice(0, 3)).toEqual([SVC, 'RevokeBotOutboundWebhook', { botUserId: 'U_bot', webhookId: 'W_out' }])
  })

  it('listWebhookFailures() is cursor-paginated', async () => {
    const ctx = makeCtx({
      failures: [{ id: 'D_1', reason: 'http_status', attempts: 3, httpStatus: 502, completedAt: 't', sourceEventId: 'E_1' }, { id: 'D_2' }],
      nextCursor: 'c2',
    })
    const m = new BotManager(ctx)
    const page = await m.listWebhookFailures('U_bot', 'W_out', { pageSize: 2, cursor: 'c1' })
    expect(lastCall(ctx).slice(0, 3)).toEqual([SVC, 'ListBotWebhookFailures', {
      botUserId: 'U_bot', webhookId: 'W_out', pageSize: 2, cursor: 'c1',
    }])
    expect(page.nextCursor).toBe('c2')
    expect(page.failures[0]!.httpStatus).toBe(502)
    expect(page.failures[1]).toEqual({ id: 'D_2', reason: '', attempts: 0, httpStatus: 0, sourceEventId: '' })

    setReply(ctx, {})
    expect(await m.listWebhookFailures('U_bot', 'W_out')).toEqual({ failures: [], nextCursor: null })
    await expect(m.listWebhookFailures('U_bot', 'W_out', { pageSize: 101 })).rejects.toBeInstanceOf(ChattoValidationError)
  })
})
