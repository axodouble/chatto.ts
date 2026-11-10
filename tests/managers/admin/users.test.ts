import { describe, it, expect, mock } from 'bun:test'
import { AdminUserManager } from '../../../src/managers/admin/users'
import { ChattoValidationError } from '../../../src/errors'

const SVC = 'chatto.admin.v1.AdminUserService'

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
const ownerWire = {
  roles: ['owner'],
  createdAt: '2026-11-10T00:15:09.328742487Z',
  user: { id: 'U_owner', login: 'sdktest', displayName: 'SDK Test', presenceStatus: 'PRESENCE_STATUS_OFFLINE' },
  viewerCanChangeDeactivation: false,
}
const botWire = {
  createdAt: '2026-11-10T00:32:50.358914195Z',
  viewerCanDeleteAccount: true,
  user: { id: 'U_bot', login: 'probe', displayName: 'Probe', bot: { ownerUserId: 'U_owner' } },
  viewerCanChangeDeactivation: false,
}

describe('AdminUserManager', () => {
  it('listIds() sends search + page', async () => {
    const ctx = makeCtx({ page: { totalCount: '1' }, userIds: ['U_owner'] })
    const page = await new AdminUserManager(ctx).listIds({ search: 'sdk', limit: 3 })
    expect(lastCall(ctx).slice(0, 3)).toEqual([SVC, 'ListMembers', { search: 'sdk', page: { limit: 3, offset: undefined } }])
    expect(page).toEqual({ items: ['U_owner'], totalCount: 1, hasMore: false })
  })

  it('list() combines ListMembers + BatchGetMembers', async () => {
    const ctx = makeCtx(null)
    ctx.rest.post = mock(async (_s: string, method: string, _b: unknown, schema: any) =>
      schema.parse(
        method === 'ListMembers'
          ? { page: { totalCount: '3', hasMore: true }, userIds: ['U_owner', 'U_bot'] }
          : { members: [ownerWire, botWire], roles: [{ name: 'owner', position: 1000 }] },
      ),
    )
    const page = await new AdminUserManager(ctx).list({ limit: 2 })
    expect(ctx.rest.post.mock.calls.map((c: any[]) => c.slice(0, 3))).toEqual([
      [SVC, 'ListMembers', { search: undefined, page: { limit: 2, offset: undefined } }],
      [SVC, 'BatchGetMembers', { userIds: ['U_owner', 'U_bot'] }],
    ])
    expect(page.userIds).toEqual(['U_owner', 'U_bot'])
    expect(page.items[1]!.roles).toEqual([])
    expect(page.items[1]!.user.bot?.ownerUserId).toBe('U_owner')
    expect(page.totalCount).toBe(3)
    expect(page.hasMore).toBe(true)
  })

  it('list() on an empty result skips the batch call', async () => {
    const ctx = makeCtx({ page: {} })
    const page = await new AdminUserManager(ctx).list()
    expect(ctx.rest.post).toHaveBeenCalledTimes(1)
    expect(page).toEqual({ items: [], userIds: [], totalCount: 0, hasMore: false })
    await expect(new AdminUserManager(ctx).listIds({ limit: 101 })).rejects.toBeInstanceOf(ChattoValidationError)
  })

  it('fetch() accepts an ID, { userId } or { login } and applies defaults', async () => {
    const ctx = makeCtx({ member: { user: { id: 'U_owner' } } })
    const m = new AdminUserManager(ctx)
    const d = await m.fetch('U_owner')
    expect(lastCall(ctx).slice(0, 3)).toEqual([SVC, 'GetMember', { userId: 'U_owner' }])
    await m.fetch({ login: 'sdktest' })
    expect(lastCall(ctx)[2]).toEqual({ login: 'sdktest' })
    await m.fetch({ userId: 'U2' })
    expect(lastCall(ctx)[2]).toEqual({ userId: 'U2' })
    expect(d.member).toMatchObject({
      roles: [], hasVerifiedEmail: false, verifiedEmails: [], viewerCanDeleteAccount: false, deactivated: false,
    })
    expect(d.member.viewerCanChangeDeactivation).toBeUndefined()
    expect(d.member.primaryVerifiedEmail).toBeUndefined()
    expect(d).toMatchObject({
      roles: [], availablePermissions: [], viewerCanAssignRoles: false, viewerCanManageRoles: false,
      viewerCanManageUserPermissions: false, assignableRoleNames: [], revocableRoleNames: [], roleAssignmentLimitsEnforced: false,
    })
  })

  it('fetch() parses a full detail response', async () => {
    const ctx = makeCtx({
      member: { ...ownerWire, hasVerifiedEmail: true, verifiedEmails: ['a@b.c'], primaryVerifiedEmail: 'a@b.c' },
      roles: [{ role: { name: 'everyone', isSystem: true } }],
      availablePermissions: ['message.read'],
      viewerCanAssignRoles: true,
      assignableRoleNames: ['moderator'],
      roleAssignmentLimitsEnforced: true,
    })
    const d = await new AdminUserManager(ctx).fetch('U_owner')
    expect(d.member.primaryVerifiedEmail).toBe('a@b.c')
    expect(d.roles[0]!.role.name).toBe('everyone')
    expect(d.assignableRoleNames).toEqual(['moderator'])
    expect(d.roleAssignmentLimitsEnforced).toBe(true)
  })

  it('fetchMany() short-circuits on [] and rejects > 100', async () => {
    const ctx = makeCtx({})
    const m = new AdminUserManager(ctx)
    expect(await m.fetchMany([])).toEqual({ members: [], roles: [] })
    expect(ctx.rest.post).not.toHaveBeenCalled()
    await expect(m.fetchMany(Array.from({ length: 101 }, (_, i) => `U${i}`))).rejects.toBeInstanceOf(ChattoValidationError)
    expect(await m.fetchMany(['U_gone'])).toEqual({ members: [], roles: [] })
    expect(lastCall(ctx).slice(0, 3)).toEqual([SVC, 'BatchGetMembers', { userIds: ['U_gone'] }])
  })

  it('getRoleAssignments() defaults omitted lists', async () => {
    const ctx = makeCtx({ assignments: { userId: 'U_owner', roleNames: ['owner'], assignableRoleNames: ['moderator', 'admin', 'owner'] } })
    const m = new AdminUserManager(ctx)
    const a = await m.getRoleAssignments('U_owner')
    expect(lastCall(ctx).slice(0, 3)).toEqual([SVC, 'GetUserRoleAssignments', { userId: 'U_owner' }])
    expect(a.revocableRoleNames).toEqual([])
    setReply(ctx, {})
    expect(await m.getRoleAssignments('U_x')).toEqual({ userId: '', roleNames: [], assignableRoleNames: [], revocableRoleNames: [] })
  })

  it('assignRole() / revokeRole() return the updated member', async () => {
    const ctx = makeCtx({ member: { ...ownerWire, roles: ['owner', 'probe'] } })
    const m = new AdminUserManager(ctx)
    expect((await m.assignRole('U_owner', 'probe')).roles).toEqual(['owner', 'probe'])
    expect(lastCall(ctx).slice(0, 3)).toEqual([SVC, 'AssignRole', { userId: 'U_owner', roleName: 'probe' }])
    setReply(ctx, { member: ownerWire })
    expect((await m.revokeRole('U_owner', 'probe')).roles).toEqual(['owner'])
    expect(lastCall(ctx).slice(0, 3)).toEqual([SVC, 'RevokeRole', { userId: 'U_owner', roleName: 'probe' }])
  })

  it('changePassword() validates length', async () => {
    const ctx = makeCtx({ member: botWire })
    const m = new AdminUserManager(ctx)
    await m.changePassword('U2', 'correct horse')
    expect(lastCall(ctx).slice(0, 3)).toEqual([SVC, 'ChangeUserPassword', { userId: 'U2', password: 'correct horse' }])
    await expect(m.changePassword('U2', 'short')).rejects.toBeInstanceOf(ChattoValidationError)
    await expect(m.changePassword('U2', 'x'.repeat(129))).rejects.toBeInstanceOf(ChattoValidationError)
  })

  it('clearUsernameCooldown() / delete() parse empty responses', async () => {
    const ctx = makeCtx({})
    const m = new AdminUserManager(ctx)
    await m.clearUsernameCooldown('U1')
    expect(lastCall(ctx).slice(0, 3)).toEqual([SVC, 'ClearUsernameCooldown', { userId: 'U1' }])
    await m.delete('U1')
    expect(lastCall(ctx).slice(0, 3)).toEqual([SVC, 'DeleteUser', { userId: 'U1' }])
  })

  it('setDeactivated() sends the flag explicitly (also false)', async () => {
    const ctx = makeCtx({ member: { user: { id: 'U2' }, deactivated: true } })
    const m = new AdminUserManager(ctx)
    expect((await m.setDeactivated('U2', true)).deactivated).toBe(true)
    expect(lastCall(ctx).slice(0, 3)).toEqual([SVC, 'SetUserDeactivated', { userId: 'U2', deactivated: true }])
    setReply(ctx, { member: { user: { id: 'U2' } } })
    expect((await m.setDeactivated('U2', false)).deactivated).toBe(false)
    expect(lastCall(ctx)[2]).toEqual({ userId: 'U2', deactivated: false })
  })
})
