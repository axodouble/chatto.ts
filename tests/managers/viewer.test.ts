import { describe, it, expect, mock } from 'bun:test'
import { ChattoValidationError } from '../../src/errors'

// Applies the response schema like the real RestClient.
function makeRestMock(returnValue: unknown) {
  return { post: mock(async (_s: string, _m: string, _i: unknown, schema: any) => schema.parse(returnValue)) }
}

import { ViewerManager } from '../../src/managers/viewer'

const SVC = 'chatto.api.v1.ViewerService'
const make = (v: unknown) => { const rest = makeRestMock(v); return { rest, manager: new ViewerManager({ rest } as any) } }

describe('ViewerManager', () => {
  it('fetch parses a live-shaped GetViewer response', async () => {
    const { rest, manager } = make({
      user: {
        settings: { timeFormat: 'TIME_FORMAT_AUTO', shareTimezone: false },
        viewerCanDeleteAccount: true,
        profile: { id: 'U1', login: 'sdktest', displayName: 'SDK Test', presenceStatus: 'PRESENCE_STATUS_OFFLINE' },
        hasPassword: true,
        actions: { changeUsername: { state: 'STATE_ALLOWED' }, changePassword: 'PASSWORD_CHANGE_AVAILABILITY_ALLOWED', deleteAccount: 'ACCOUNT_DELETION_AVAILABILITY_ALLOWED' },
      },
      capabilities: { grants: [{ capability: 'admin.view', granted: true }, { capability: 'role.view' }] },
      viewerPermissions: { permissions: [{ permission: 'server.manage' }, { permission: 'room.join', granted: true }] },
      viewerState: {},
      privilegedMode: { available: true },
    })
    const v = await manager.fetch()
    expect(rest.post).toHaveBeenCalledWith(SVC, 'GetViewer', {}, expect.anything())
    expect(v.user.profile?.id).toBe('U1')
    expect(v.user.hasVerifiedEmail).toBe(false)
    expect(v.user.actions?.changeUsername?.state).toBe('STATE_ALLOWED')
    expect(v.capabilities.grants[1]).toEqual({ capability: 'role.view', granted: false })
    expect(v.viewerPermissions.permissions[0]).toEqual({ permission: 'server.manage', granted: false })
    expect(v.viewerState.hasUnreadRooms).toBe(false)
    expect(v.privilegedMode).toEqual({ available: true, active: false })
  })

  it('fetch defaults every section of an empty response', async () => {
    const { manager } = make({})
    const v = await manager.fetch()
    expect(v.user.profile).toBeUndefined()
    expect(v.capabilities).toEqual({ grants: [], hasUnreadFollowedThreads: false })
    expect(v.viewerPermissions.permissions).toEqual([])
    expect(v.privilegedMode.active).toBe(false)
  })

  it('activatePrivilegedMode posts and parses', async () => {
    const { rest, manager } = make({ privilegedMode: { available: true, active: true, expiresAt: '2026-11-10T01:00:00Z' } })
    const r = await manager.activatePrivilegedMode()
    expect(rest.post).toHaveBeenCalledWith(SVC, 'ActivatePrivilegedMode', {}, expect.anything())
    expect(r.privilegedMode.expiresAt).toBe('2026-11-10T01:00:00Z')
    expect(r.capabilities.grants).toEqual([])
  })

  it('deactivatePrivilegedMode posts and defaults', async () => {
    const { rest, manager } = make({})
    const r = await manager.deactivatePrivilegedMode()
    expect(rest.post).toHaveBeenCalledWith(SVC, 'DeactivatePrivilegedMode', {}, expect.anything())
    expect(r.privilegedMode).toEqual({ available: false, active: false })
  })
})
