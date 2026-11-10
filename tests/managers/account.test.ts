import { describe, it, expect, mock } from 'bun:test'
import { AccountManager } from '../../src/managers/account'
import { ChattoApiError, ChattoValidationError } from '../../src/errors'

const SVC = 'chatto.api.v1.MyAccountService'

// The mock applies the response schema like the real RestClient does, so
// proto3-omitted fields exercise the schema defaults.
function makeRestMock(returnValue: unknown) {
  return { post: mock(async (_s: string, _m: string, _i: unknown, schema: any) => schema.parse(returnValue)) }
}

/** Mock keyed by method name; the handler's result is parsed with the RPC's schema. */
function routedRest(handler: (method: string) => Promise<unknown>) {
  return { post: mock(async (_s: string, method: string, _i: unknown, schema: any) => schema.parse(await handler(method))) }
}

function make(returnValue: unknown) {
  const rest = makeRestMock(returnValue)
  return { rest, manager: new AccountManager({ rest } as any) }
}

describe('AccountManager', () => {
  describe('.updatePresence()', () => {
    it('posts SetPresence and returns the accepted status', async () => {
      const { rest, manager } = make({ status: 'PRESENCE_STATUS_ONLINE' })
      const status = await manager.updatePresence('PRESENCE_STATUS_ONLINE', true)
      expect(rest.post).toHaveBeenCalledWith(SVC, 'SetPresence', { status: 'PRESENCE_STATUS_ONLINE', userSelected: true }, expect.anything())
      expect(status).toBe('PRESENCE_STATUS_ONLINE')
    })
  })

  describe('.updateCustomStatus()', () => {
    it('posts SetCustomStatus with serialized expiry', async () => {
      const { rest, manager } = make({ status: { emoji: '🎧', text: 'listening' } })
      const result = await manager.updateCustomStatus({
        emoji: '🎧',
        text: 'listening',
        expiresAt: new Date('2026-07-15T12:00:00.000Z'),
      })
      expect(rest.post).toHaveBeenCalledWith(SVC, 'SetCustomStatus', { emoji: '🎧', text: 'listening', expiresAt: '2026-07-15T12:00:00.000Z' }, expect.anything())
      expect(result.emoji).toBe('🎧')
    })

    it('omits expiresAt when not provided', async () => {
      const { rest, manager } = make({ status: { emoji: '🎧', text: 'hi' } })
      await manager.updateCustomStatus({ emoji: '🎧', text: 'hi' })
      expect(rest.post).toHaveBeenCalledWith(SVC, 'SetCustomStatus', { emoji: '🎧', text: 'hi', expiresAt: undefined }, expect.anything())
    })
  })

  describe('.deleteCustomStatus()', () => {
    it('posts DeleteCustomStatus with an empty body', async () => {
      const { rest, manager } = make({})
      await manager.deleteCustomStatus()
      expect(rest.post).toHaveBeenCalledWith(SVC, 'DeleteCustomStatus', {}, expect.anything())
    })
  })

  describe('presence preference', () => {
    it('getPresencePreference returns undefined before first save', async () => {
      const { rest, manager } = make({})
      expect(await manager.getPresencePreference()).toBeUndefined()
      expect(rest.post).toHaveBeenCalledWith(SVC, 'GetPresencePreference', {}, expect.anything())
    })

    it('setPresencePreference sends the given revision directly', async () => {
      const { rest, manager } = make({ preference: { status: 'PRESENCE_STATUS_OFFLINE', revision: 'r2' } })
      const pref = await manager.setPresencePreference('invisible', { expectedRevision: 'r1' })
      expect(rest.post).toHaveBeenCalledTimes(1)
      expect(rest.post).toHaveBeenCalledWith(SVC, 'SetPresencePreference', { status: 'PRESENCE_STATUS_OFFLINE', expectedRevision: 'r1' }, expect.anything())
      expect(pref).toEqual({ status: 'PRESENCE_STATUS_OFFLINE', revision: 'r2' })
    })

    it('setPresencePreference reads the revision first when none is given', async () => {
      const rest = routedRest(async (method: string) => {
          if (method === 'GetPresencePreference') return { preference: { status: 'PRESENCE_STATUS_ONLINE', revision: 'r1' } }
          return { preference: { status: 'PRESENCE_STATUS_DO_NOT_DISTURB', revision: 'r2' } }
      })
      const manager = new AccountManager({ rest } as any)
      const pref = await manager.setPresencePreference('dnd')
      expect(rest.post.mock.calls[1]).toEqual([SVC, 'SetPresencePreference', { status: 'PRESENCE_STATUS_DO_NOT_DISTURB', expectedRevision: 'r1' }, expect.anything()])
      expect(pref.revision).toBe('r2')
    })

    it('initializes with an empty revision and retries once on ABORTED', async () => {
      let sets = 0
      const rest = routedRest(async (method: string) => {
          if (method === 'GetPresencePreference') return sets === 0 ? {} : { preference: { status: 'PRESENCE_STATUS_AWAY', revision: 'r9' } }
          sets++
          if (sets === 1) throw new ChattoApiError('aborted', 'optimistic concurrency sequence mismatch', {})
          return { preference: { status: 'PRESENCE_STATUS_ONLINE', revision: 'r10' } }
      })
      const manager = new AccountManager({ rest } as any)
      const pref = await manager.setPresencePreference('PRESENCE_STATUS_ONLINE')
      const setCalls = rest.post.mock.calls.filter(c => c[1] === 'SetPresencePreference')
      expect(setCalls.map(c => (c[2] as any).expectedRevision)).toEqual(['', 'r9'])
      expect(pref.revision).toBe('r10')
    })

    it('refreshPresence posts RefreshPresence and handles an empty response', async () => {
      const { rest, manager } = make({})
      expect(await manager.refreshPresence()).toBeUndefined()
      expect(rest.post).toHaveBeenCalledWith(SVC, 'RefreshPresence', {}, expect.anything())
    })

    it('refreshPresence returns the saved choice, defaulting omitted status', async () => {
      const { manager } = make({ preference: { revision: 'r1' } })
      expect(await manager.refreshPresence()).toEqual({ status: 'PRESENCE_STATUS_UNSPECIFIED', revision: 'r1' })
    })
  })

  describe('.changePassword()', () => {
    it('posts ChangePassword and returns the profile', async () => {
      const { rest, manager } = make({ user: { id: 'U1', login: 'me' } })
      const user = await manager.changePassword('new-password', { currentPassword: 'old-password' })
      expect(rest.post).toHaveBeenCalledWith(SVC, 'ChangePassword', { password: 'new-password', currentPassword: 'old-password' }, expect.anything())
      expect(user?.login).toBe('me')
      expect(user?.deactivated).toBe(false)
    })

    it('rejects too-short passwords client-side', async () => {
      const { rest, manager } = make({})
      await expect(manager.changePassword('short')).rejects.toBeInstanceOf(ChattoValidationError)
      expect(rest.post).not.toHaveBeenCalled()
    })
  })

  describe('verified emails', () => {
    it('listVerifiedEmails resolves expectedUserId via GetViewer when omitted', async () => {
      const rest = routedRest(async (method: string) => {
          if (method === 'GetViewer') return { user: { profile: { id: 'U1' } } }
          return {}
      })
      const manager = new AccountManager({ rest } as any)
      expect(await manager.listVerifiedEmails()).toEqual([])
      expect(rest.post.mock.calls[0]?.[0]).toBe('chatto.api.v1.ViewerService')
      expect(rest.post.mock.calls[1]).toEqual([SVC, 'ListVerifiedEmails', { expectedUserId: 'U1' }, expect.anything()])
    })

    it('listVerifiedEmails parses rows with defaults', async () => {
      const { manager } = make({ verifiedEmails: [{ email: 'a@x.io', verifiedAt: '2026-01-01T00:00:00Z', primary: true }, { email: 'b@x.io' }] })
      const emails = await manager.listVerifiedEmails({ expectedUserId: 'U1' })
      expect(emails[0]).toEqual({ email: 'a@x.io', verifiedAt: '2026-01-01T00:00:00Z', primary: true })
      expect(emails[1]?.primary).toBe(false)
    })

    it('requestEmailVerification posts email + expectedUserId', async () => {
      const { rest, manager } = make({})
      await manager.requestEmailVerification('a@x.io', { expectedUserId: 'U1' })
      expect(rest.post).toHaveBeenCalledWith(SVC, 'RequestEmailVerification', { email: 'a@x.io', expectedUserId: 'U1' }, expect.anything())
    })

    it('confirmEmailVerification posts the code', async () => {
      const { rest, manager } = make({ verifiedEmails: [{ email: 'a@x.io' }] })
      const res = await manager.confirmEmailVerification('a@x.io', '123456', { expectedUserId: 'U1' })
      expect(rest.post).toHaveBeenCalledWith(SVC, 'ConfirmEmailVerification', { email: 'a@x.io', code: '123456', expectedUserId: 'U1' }, expect.anything())
      expect(res).toHaveLength(1)
    })

    it('setPrimaryEmail posts and returns the list', async () => {
      const { rest, manager } = make({})
      expect(await manager.setPrimaryEmail('a@x.io', { expectedUserId: 'U1' })).toEqual([])
      expect(rest.post).toHaveBeenCalledWith(SVC, 'SetPrimaryEmail', { email: 'a@x.io', expectedUserId: 'U1' }, expect.anything())
    })
  })

  describe('settings', () => {
    it('getSettings parses live-shaped settings', async () => {
      const { rest, manager } = make({ settings: { timeFormat: 'TIME_FORMAT_AUTO', shareTimezone: false } })
      const s = await manager.getSettings()
      expect(rest.post).toHaveBeenCalledWith(SVC, 'GetSettings', {}, expect.anything())
      expect(s).toEqual({ timeFormat: 'TIME_FORMAT_AUTO', shareTimezone: false })
    })

    it('getSettings defaults an empty response', async () => {
      const { manager } = make({})
      expect(await manager.getSettings()).toEqual({ timeFormat: 'TIME_FORMAT_UNSPECIFIED' })
    })

    it('updateSettings infers the mask and sends null fields as resets', async () => {
      const { rest, manager } = make({ settings: { timeFormat: 'TIME_FORMAT_24_HOUR' } })
      await manager.updateSettings({ timeFormat: 'TIME_FORMAT_24_HOUR', timezone: null })
      expect(rest.post).toHaveBeenCalledWith(SVC, 'UpdateSettings', { timeFormat: 'TIME_FORMAT_24_HOUR', updateMask: 'timeFormat,timezone' }, expect.anything())
    })

    it('updateSettings honors an explicit mask', async () => {
      const { rest, manager } = make({})
      await manager.updateSettings({ shareTimezone: true }, { updateMask: '*' })
      expect(rest.post).toHaveBeenCalledWith(SVC, 'UpdateSettings', { shareTimezone: true, updateMask: '*' }, expect.anything())
    })

    it('updateSettings rejects an empty patch', async () => {
      const { manager } = make({})
      await expect(manager.updateSettings({})).rejects.toBeInstanceOf(ChattoValidationError)
    })
  })

  describe('external identities', () => {
    it('listExternalIdentities defaults empty arrays', async () => {
      const { rest, manager } = make({})
      expect(await manager.listExternalIdentities()).toEqual({ providers: [], linkedIdentities: [] })
      expect(rest.post).toHaveBeenCalledWith(SVC, 'ListExternalIdentities', {}, expect.anything())
    })

    it('listExternalIdentities parses providers and linked identities', async () => {
      const { manager } = make({
        providers: [{ linkUrl: '/link/gh', provider: { id: 'gh', type: 'github', label: 'GitHub' } }],
        linkedIdentities: [{ providerId: 'gh', subjectHash: 'h1', disconnectEligibility: 'DISCONNECT_ELIGIBILITY_ALLOWED' }],
      })
      const res = await manager.listExternalIdentities()
      expect(res.providers[0]?.linked).toBe(false)
      expect(res.providers[0]?.provider?.label).toBe('GitHub')
      expect(res.linkedIdentities[0]?.disconnectEligibility).toBe('DISCONNECT_ELIGIBILITY_ALLOWED')
    })

    it('startExternalIdentityLink returns the start URL', async () => {
      const { rest, manager } = make({ startUrl: 'https://chat.example/start' })
      expect(await manager.startExternalIdentityLink('gh', { redirectPath: '/settings' })).toBe('https://chat.example/start')
      expect(rest.post).toHaveBeenCalledWith(SVC, 'StartExternalIdentityLink', { providerId: 'gh', redirectPath: '/settings', currentPassword: undefined }, expect.anything())
    })

    it('disconnectExternalIdentity posts the subject hash', async () => {
      const { rest, manager } = make({})
      await manager.disconnectExternalIdentity('h1', { currentPassword: 'pw' })
      expect(rest.post).toHaveBeenCalledWith(SVC, 'DisconnectExternalIdentity', { subjectHash: 'h1', currentPassword: 'pw' }, expect.anything())
    })
  })

  describe('account deletion', () => {
    it('requestAccountDeletion returns the token', async () => {
      const { rest, manager } = make({ confirmationToken: 'tok' })
      expect(await manager.requestAccountDeletion()).toBe('tok')
      expect(rest.post).toHaveBeenCalledWith(SVC, 'RequestAccountDeletion', {}, expect.anything())
    })

    it('deleteMyAccount posts the token', async () => {
      const { rest, manager } = make({})
      await manager.deleteMyAccount('tok')
      expect(rest.post).toHaveBeenCalledWith(SVC, 'DeleteMyAccount', { confirmationToken: 'tok' }, expect.anything())
    })
  })
})
