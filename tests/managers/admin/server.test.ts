import { describe, it, expect, mock } from 'bun:test'
import { AdminServerManager } from '../../../src/managers/admin/server'
import { ChattoValidationError } from '../../../src/errors'

const SVC = 'chatto.admin.v1.AdminServerService'

// The mock runs the real Zod schema (4th arg), like RestClient does, so the
// tests exercise proto3 default handling.
function makeCtx(reply: unknown) {
  const ctx: any = { rest: {}, reply }
  ctx.rest.post = mock(async (_s: string, _m: string, _b: unknown, schema: any) => schema.parse(ctx.reply))
  return ctx
}
function lastCall(ctx: any) {
  return ctx.rest.post.mock.calls.at(-1)
}

// Shapes captured from a live Chatto 0.5.0 server.
const profileWire = { name: 'Chatto.ts Test', version: '0.5.0', description: 'Disposable server for SDK live tests' }
const configWire = {
  config: {
    serverName: 'Chatto.ts Test',
    description: 'Disposable server for SDK live tests',
    registration: { admission: 'ACCOUNT_CREATION_POLICY_OPEN' },
  },
  publicProfile: profileWire,
}
const neighborWire = { id: 'N6CdjrplzcaJdDR', origin: 'https://neighbor-probe.example.com', revision: 'E4Wsb0VLpz5k4kL' }

describe('AdminServerManager', () => {
  it('getConfig() parses settings and defaults omitted fields', async () => {
    const ctx = makeCtx(configWire)
    const m = new AdminServerManager(ctx)
    const res = await m.getConfig()
    expect(lastCall(ctx).slice(0, 3)).toEqual([SVC, 'GetServerConfig', {}])
    expect(res.config.motd).toBe('')
    expect(res.config.welcomeMessage).toBe('')
    expect(res.config.registration.admission).toBe('ACCOUNT_CREATION_POLICY_OPEN')
    expect(res.publicProfile.logoUrl).toBeUndefined()

    ctx.reply = {}
    const empty = await m.getConfig()
    expect(empty.config).toEqual({
      serverName: '', description: '', motd: '', welcomeMessage: '',
      registration: { admission: 'ACCOUNT_CREATION_POLICY_UNSPECIFIED' },
    })
    expect(empty.publicProfile).toEqual({ name: '', version: '' })
  })

  it('updateConfig() builds the mask, nests admission and resets nulls', async () => {
    const ctx = makeCtx(configWire)
    const m = new AdminServerManager(ctx)
    await m.updateConfig({ motd: 'hello', welcomeMessage: null, admission: 'ACCOUNT_CREATION_POLICY_INVITE_ONLY' })
    expect(lastCall(ctx).slice(0, 3)).toEqual([
      SVC,
      'UpdateServerConfig',
      {
        motd: 'hello',
        registration: { admission: 'ACCOUNT_CREATION_POLICY_INVITE_ONLY' },
        updateMask: 'motd,welcomeMessage,registration.admission',
      },
    ])
    await m.updateConfig({ admission: null })
    expect(lastCall(ctx)[2]).toEqual({ registration: {}, updateMask: 'registration.admission' })
    await m.updateConfig({ motd: '' })
    expect(lastCall(ctx)[2]).toEqual({ motd: '', updateMask: 'motd' })
  })

  it('updateConfig() validates limits and empty updates', async () => {
    const ctx = makeCtx(configWire)
    const m = new AdminServerManager(ctx)
    await expect(m.updateConfig({})).rejects.toBeInstanceOf(ChattoValidationError)
    await expect(m.updateConfig({ serverName: 'x'.repeat(81) })).rejects.toBeInstanceOf(ChattoValidationError)
    await expect(m.updateConfig({ welcomeMessage: 'x'.repeat(10001) })).rejects.toBeInstanceOf(ChattoValidationError)
    expect(ctx.rest.post).not.toHaveBeenCalled()
  })

  it('uploadLogo()/uploadBanner() send base64 ImageUpload and reject empty images', async () => {
    const ctx = makeCtx({ publicProfile: { ...profileWire, logoUrl: '/logo.webp' } })
    const m = new AdminServerManager(ctx)
    const profile = await m.uploadLogo({ data: new Uint8Array([1, 2, 3]), filename: 'logo.png', contentType: 'image/png' })
    expect(lastCall(ctx).slice(0, 3)).toEqual([
      SVC, 'UploadServerLogo', { image: { image: 'AQID', filename: 'logo.png', contentType: 'image/png' } },
    ])
    expect(profile.logoUrl).toBe('/logo.webp')

    await m.uploadBanner({ data: new Uint8Array([255]).buffer, filename: 'b.jpg' })
    expect(lastCall(ctx).slice(0, 3)).toEqual([
      SVC, 'UploadServerBanner', { image: { image: '/w==', filename: 'b.jpg', contentType: undefined } },
    ])
    await expect(m.uploadLogo({ data: new Uint8Array(), filename: 'x.png' })).rejects.toBeInstanceOf(
      ChattoValidationError,
    )
  })

  it('deleteLogo()/deleteBanner() return the profile, defaulting an empty response', async () => {
    const ctx = makeCtx({ publicProfile: profileWire })
    const m = new AdminServerManager(ctx)
    expect((await m.deleteLogo()).name).toBe('Chatto.ts Test')
    expect(lastCall(ctx).slice(0, 3)).toEqual([SVC, 'DeleteServerLogo', {}])
    ctx.reply = {}
    expect(await m.deleteBanner()).toEqual({ name: '', version: '' })
    expect(lastCall(ctx).slice(0, 3)).toEqual([SVC, 'DeleteServerBanner', {}])
  })

  it('getSecurityConfig() defaults the blocked list', async () => {
    const ctx = makeCtx({ blockedUsernames: ['root', 'admin'] })
    const m = new AdminServerManager(ctx)
    expect(await m.getSecurityConfig()).toEqual({ blockedUsernames: ['root', 'admin'] })
    expect(lastCall(ctx).slice(0, 3)).toEqual([SVC, 'GetServerSecurityConfig', {}])
    ctx.reply = {}
    expect(await m.getSecurityConfig()).toEqual({ blockedUsernames: [] })
  })

  it('setBlockedUsernames() always selects the field so [] clears', async () => {
    const ctx = makeCtx({})
    const m = new AdminServerManager(ctx)
    expect(await m.setBlockedUsernames([])).toEqual([])
    expect(lastCall(ctx).slice(0, 3)).toEqual([
      SVC, 'UpdateBlockedUsernames', { blockedUsernames: [], updateMask: 'blockedUsernames' },
    ])
    ctx.reply = { blockedUsernames: ['root'] }
    expect(await m.setBlockedUsernames(['Root'])).toEqual(['root'])
    await expect(m.setBlockedUsernames(Array.from({ length: 1001 }, (_, i) => `u${i}`))).rejects.toBeInstanceOf(
      ChattoValidationError,
    )
  })

  it('listNeighbors() / fetchNeighbor()', async () => {
    const ctx = makeCtx({})
    const m = new AdminServerManager(ctx)
    expect(await m.listNeighbors()).toEqual([])
    expect(lastCall(ctx).slice(0, 3)).toEqual([SVC, 'ListNeighbors', {}])
    ctx.reply = { neighbors: [neighborWire] }
    expect(await m.listNeighbors()).toEqual([neighborWire])
    ctx.reply = { neighbor: { id: 'N1' } }
    expect(await m.fetchNeighbor('N1')).toEqual({ id: 'N1', origin: '', revision: '' })
    expect(lastCall(ctx).slice(0, 3)).toEqual([SVC, 'GetNeighbor', { neighborId: 'N1' }])
  })

  it('createNeighbor() / updateNeighbor() / deleteNeighbor()', async () => {
    const ctx = makeCtx({ neighbor: neighborWire })
    const m = new AdminServerManager(ctx)
    expect(await m.createNeighbor('https://neighbor-probe.example.com/')).toEqual(neighborWire)
    expect(lastCall(ctx).slice(0, 3)).toEqual([SVC, 'CreateNeighbor', { origin: 'https://neighbor-probe.example.com/' }])
    await expect(m.createNeighbor('')).rejects.toBeInstanceOf(ChattoValidationError)

    await m.updateNeighbor('N1', { origin: 'https://b.example', revision: 'r1' })
    expect(lastCall(ctx).slice(0, 3)).toEqual([
      SVC, 'UpdateNeighbor', { neighborId: 'N1', origin: 'https://b.example', revision: 'r1', updateMask: 'origin' },
    ])

    ctx.reply = {}
    await expect(m.deleteNeighbor('N1', 'r2')).resolves.toBeUndefined()
    expect(lastCall(ctx).slice(0, 3)).toEqual([SVC, 'DeleteNeighbor', { neighborId: 'N1', revision: 'r2' }])
  })
})
