import { describe, it, expect, mock } from 'bun:test'
import { ChattoValidationError } from '../../src/errors'

// Applies the response schema like the real RestClient.
function makeRestMock(returnValue: unknown) {
  return { post: mock(async (_s: string, _m: string, _i: unknown, schema: any) => schema.parse(returnValue)) }
}

import { PushNotificationManager } from '../../src/managers/push'

const SVC = 'chatto.api.v1.PushNotificationService'
const make = (v: unknown) => { const rest = makeRestMock(v); return { rest, manager: new PushNotificationManager({ rest } as any) } }
const sub = { endpoint: 'https://push.example/abc', keys: { p256dh: 'pk', auth: 'au' } }

describe('PushNotificationManager', () => {
  it('subscribe flattens the PushSubscription and generates a cleanup token', async () => {
    const { rest, manager } = make({})
    const { cleanupToken } = await manager.subscribe(sub, { clientHost: 'chat.example:4000', userAgent: 'bot' })
    expect(cleanupToken.length).toBeGreaterThanOrEqual(32)
    expect(rest.post).toHaveBeenCalledWith(SVC, 'Subscribe', {
      endpoint: 'https://push.example/abc', p256dh: 'pk', auth: 'au', userAgent: 'bot', clientHost: 'chat.example:4000', cleanupToken,
    }, expect.anything())
  })

  it('subscribe validates a supplied cleanup token', async () => {
    const { rest, manager } = make({})
    await expect(manager.subscribe(sub, { clientHost: 'h', cleanupToken: 'short' })).rejects.toBeInstanceOf(ChattoValidationError)
    expect(rest.post).not.toHaveBeenCalled()
  })

  it('unsubscribe posts the endpoint', async () => {
    const { rest, manager } = make({})
    await manager.unsubscribe('https://push.example/abc')
    expect(rest.post).toHaveBeenCalledWith(SVC, 'Unsubscribe', { endpoint: 'https://push.example/abc' }, expect.anything())
  })

  it('sendTestNotification posts an empty body', async () => {
    const { rest, manager } = make({})
    await manager.sendTestNotification()
    expect(rest.post).toHaveBeenCalledWith(SVC, 'SendTestNotification', {}, expect.anything())
  })
})
