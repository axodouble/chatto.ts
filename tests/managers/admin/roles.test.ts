import { describe, it, expect, mock } from 'bun:test'
import { AdminRoleManager } from '../../../src/managers/admin/roles'
import { ChattoValidationError } from '../../../src/errors'

const SVC = 'chatto.admin.v1.AdminRoleService'

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
const everyone = {
  role: { name: 'everyone', displayName: 'Everyone', description: 'All authenticated users', isSystem: true },
  memberCount: '1', permissionGrantCount: '14', permissionDenialCount: '1',
}
const moderator = {
  role: { name: 'moderator', displayName: 'Moderator', isSystem: true, position: 100, pingable: true },
  memberCount: '0', permissionGrantCount: '3', permissionDenialCount: '0',
}

describe('AdminRoleManager', () => {
  it('list() parses counts (uint64 strings) and capability flags', async () => {
    const ctx = makeCtx({ roles: [everyone, moderator], viewerCanManageRoles: true, viewerCanAssignRoles: true })
    const cat = await new AdminRoleManager(ctx).list()
    expect(lastCall(ctx).slice(0, 3)).toEqual([SVC, 'ListRoles', {}])
    expect(cat.roles[0]!.memberCount).toBe(1)
    expect(cat.roles[0]!.role.position).toBe(0)
    expect(cat.roles[1]!.permissionDenialCount).toBe(0)
    expect(cat.viewerCanManageRoles).toBe(true)
  })

  it('list() handles an empty {} response', async () => {
    const cat = await new AdminRoleManager(makeCtx({})).list()
    expect(cat).toEqual({ roles: [], viewerCanManageRoles: false, viewerCanAssignRoles: false })
  })

  it('fetch() calls GetRole; counts absent outside ListRoles', async () => {
    const ctx = makeCtx({ role: { role: { name: 'admin', position: 900 } } })
    const d = await new AdminRoleManager(ctx).fetch('admin')
    expect(lastCall(ctx).slice(0, 3)).toEqual([SVC, 'GetRole', { name: 'admin' }])
    expect(d.role.memberCount).toBeUndefined()
    expect(d.role.role.isSystem).toBe(false)
    expect(d.viewerCanAssignRoles).toBe(false)
  })

  it('listMembers() pages public users and enforces limit <= 100', async () => {
    const ctx = makeCtx({ members: [{ id: 'U1', login: 'a' }], page: { totalCount: '1' } })
    const m = new AdminRoleManager(ctx)
    const page = await m.listMembers('owner', { limit: 10 })
    expect(lastCall(ctx).slice(0, 3)).toEqual([SVC, 'ListMembers', { name: 'owner', page: { limit: 10, offset: undefined } }])
    expect(page.items[0]!.id).toBe('U1')
    expect(page.totalCount).toBe(1)
    setReply(ctx, {})
    expect(await m.listMembers('everyone')).toEqual({ items: [], totalCount: 0, hasMore: false })
    await expect(m.listMembers('x', { limit: 101 })).rejects.toBeInstanceOf(ChattoValidationError)
  })

  it('create() omits empty fields and validates lengths', async () => {
    const ctx = makeCtx({ role: { role: { name: 'probe', position: 1 } } })
    const m = new AdminRoleManager(ctx)
    const role = await m.create({ name: 'probe' })
    expect(lastCall(ctx).slice(0, 3)).toEqual([
      SVC, 'CreateRole', { name: 'probe', displayName: undefined, description: undefined, pingable: undefined },
    ])
    expect(role.role.name).toBe('probe')
    await m.create({ name: 'p', displayName: 'P', description: 'd', pingable: true })
    expect(lastCall(ctx)[2]).toEqual({ name: 'p', displayName: 'P', description: 'd', pingable: true })
    await expect(m.create({ name: 'x', displayName: 'a'.repeat(81) })).rejects.toBeInstanceOf(ChattoValidationError)
    await expect(m.create({ name: 'x', description: 'a'.repeat(501) })).rejects.toBeInstanceOf(ChattoValidationError)
  })

  it('update() infers the field mask; null resets', async () => {
    const ctx = makeCtx({ role: { role: { name: 'probe', description: 'd', pingable: true } } })
    const m = new AdminRoleManager(ctx)
    await m.update('probe', { description: 'd', pingable: true })
    expect(lastCall(ctx).slice(0, 3)).toEqual([
      SVC, 'UpdateRole', { name: 'probe', description: 'd', pingable: true, updateMask: 'description,pingable' },
    ])
    await m.update('probe', { displayName: null })
    expect(lastCall(ctx)[2]).toEqual({ name: 'probe', updateMask: 'displayName' })
    await expect(m.update('probe', {})).rejects.toBeInstanceOf(ChattoValidationError)
  })

  it('delete() and reorder()', async () => {
    const ctx = makeCtx({})
    const m = new AdminRoleManager(ctx)
    await m.delete('probe')
    expect(lastCall(ctx).slice(0, 3)).toEqual([SVC, 'DeleteRole', { name: 'probe' }])
    setReply(ctx, { roles: [everyone] })
    const roles = await m.reorder(['a', 'b'])
    expect(lastCall(ctx).slice(0, 3)).toEqual([SVC, 'ReorderRoles', { roleNames: ['a', 'b'] }])
    expect(roles).toHaveLength(1)
    setReply(ctx, {})
    expect(await m.reorder([])).toEqual([])
    await expect(m.reorder(Array.from({ length: 1001 }, (_, i) => `r${i}`))).rejects.toBeInstanceOf(ChattoValidationError)
  })
})
