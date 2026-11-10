import { describe, it, expect, mock } from 'bun:test'
import { AccountManager } from '../../src/managers/account'

function makeRestMock(returnValue: unknown) {
  return { post: mock().mockResolvedValue(returnValue) }
}

describe('AccountManager', () => {
  describe('.updatePresence()', () => {
    it('posts SetPresence and returns the accepted status', async () => {
      const rest = makeRestMock({ status: 'PRESENCE_STATUS_ONLINE' })
      const manager = new AccountManager({ rest } as any)
      const status = await manager.updatePresence('PRESENCE_STATUS_ONLINE', true)
      expect(rest.post).toHaveBeenCalledWith(
        'chatto.api.v1.MyAccountService',
        'SetPresence',
        { status: 'PRESENCE_STATUS_ONLINE', userSelected: true },
        expect.anything(),
      )
      expect(status).toBe('PRESENCE_STATUS_ONLINE')
    })
  })

  describe('.updateCustomStatus()', () => {
    it('posts SetCustomStatus with serialized expiry', async () => {
      const rest = makeRestMock({ status: { emoji: '🎧', text: 'listening' } })
      const manager = new AccountManager({ rest } as any)
      const result = await manager.updateCustomStatus({
        emoji: '🎧',
        text: 'listening',
        expiresAt: new Date('2026-07-15T12:00:00.000Z'),
      })
      expect(rest.post).toHaveBeenCalledWith(
        'chatto.api.v1.MyAccountService',
        'SetCustomStatus',
        { emoji: '🎧', text: 'listening', expiresAt: '2026-07-15T12:00:00.000Z' },
        expect.anything(),
      )
      expect(result.emoji).toBe('🎧')
    })

    it('omits expiresAt when not provided', async () => {
      const rest = makeRestMock({ status: { emoji: '🎧', text: 'hi' } })
      const manager = new AccountManager({ rest } as any)
      await manager.updateCustomStatus({ emoji: '🎧', text: 'hi' })
      expect(rest.post).toHaveBeenCalledWith(
        'chatto.api.v1.MyAccountService',
        'SetCustomStatus',
        { emoji: '🎧', text: 'hi', expiresAt: undefined },
        expect.anything(),
      )
    })
  })

  describe('.deleteCustomStatus()', () => {
    it('posts DeleteCustomStatus with an empty body', async () => {
      const rest = makeRestMock({})
      const manager = new AccountManager({ rest } as any)
      await manager.deleteCustomStatus()
      expect(rest.post).toHaveBeenCalledWith(
        'chatto.api.v1.MyAccountService',
        'DeleteCustomStatus',
        {},
        expect.anything(),
      )
    })
  })
})
