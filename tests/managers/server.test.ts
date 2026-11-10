import { describe, it, expect, mock } from 'bun:test'
import { ChattoValidationError } from '../../src/errors'

// Applies the response schema like the real RestClient.
function makeRestMock(returnValue: unknown) {
  return { post: mock(async (_s: string, _m: string, _i: unknown, schema: any) => schema.parse(returnValue)) }
}

import { ServerManager } from '../../src/managers/server'

const SVC = 'chatto.api.v1.ServerService'
const make = (v: unknown) => { const rest = makeRestMock(v); return { rest, manager: new ServerManager({ rest } as any) } }

describe('ServerManager', () => {
  it('fetchProfile parses the profile', async () => {
    const { rest, manager } = make({ profile: { name: 'Chatto.ts Test', version: '0.5.0', description: 'Disposable' } })
    const p = await manager.fetchProfile()
    expect(rest.post).toHaveBeenCalledWith(SVC, 'GetServerProfile', {}, expect.anything())
    expect(p).toEqual({ name: 'Chatto.ts Test', version: '0.5.0', description: 'Disposable' })
  })

  it('fetchProfile defaults an empty response', async () => {
    const { manager } = make({})
    expect(await manager.fetchProfile()).toEqual({ name: '', version: '' })
  })

  it('fetchMotd returns undefined when unset', async () => {
    const { rest, manager } = make({})
    expect(await manager.fetchMotd()).toBeUndefined()
    expect(rest.post).toHaveBeenCalledWith(SVC, 'GetMotd', {}, expect.anything())
  })

  it('fetchMotd returns the motd', async () => {
    const { manager } = make({ motd: 'hello' })
    expect(await manager.fetchMotd()).toBe('hello')
  })

  it('fetchRuntimeConfig coerces int64 strings and defaults omitted fields', async () => {
    const { rest, manager } = make({ runtime: { maxUploadSize: '26214400', maxVideoUploadSize: '26214400', messageEditWindowSeconds: 10800 } })
    const c = await manager.fetchRuntimeConfig()
    expect(rest.post).toHaveBeenCalledWith(SVC, 'GetRuntimeConfig', {}, expect.anything())
    expect(c.maxUploadSize).toBe(26214400)
    expect(c.messageEditWindowSeconds).toBe(10800)
    expect(c.pushNotificationsEnabled).toBe(false)
    expect(c.livekitUrl).toBeUndefined()
  })

  it('fetchRuntimeConfig defaults an empty response', async () => {
    const { manager } = make({})
    expect((await manager.fetchRuntimeConfig()).maxUploadSize).toBe(0)
  })
})
