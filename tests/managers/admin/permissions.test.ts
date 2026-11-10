import { describe, it, expect, mock } from 'bun:test'
import {
  AdminPermissionManager,
  toPermissionScope,
  toPermissionDecision,
} from '../../../src/managers/admin/permissions'
import { ChattoValidationError } from '../../../src/errors'

const SVC = 'chatto.admin.v1.AdminPermissionService'

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

const DM = { kind: 'PERMISSION_SCOPE_KIND_DM' }

describe('permission scope/decision helpers', () => {
  it('maps friendly scopes to wire scopes', () => {
    expect(toPermissionScope('server')).toEqual({ kind: 'PERMISSION_SCOPE_KIND_SERVER' })
    expect(toPermissionScope('dm')).toEqual(DM)
    expect(toPermissionScope({ roomId: 'R1' })).toEqual({ kind: 'PERMISSION_SCOPE_KIND_ROOM', id: 'R1' })
    expect(toPermissionScope({ groupId: 'G1' })).toEqual({ kind: 'PERMISSION_SCOPE_KIND_GROUP', id: 'G1' })
    expect(toPermissionScope({ kind: 'PERMISSION_SCOPE_KIND_DM', id: '' })).toEqual(DM)
    expect(toPermissionScope({ kind: 'PERMISSION_SCOPE_KIND_ROOM', id: 'R2' })).toEqual({ kind: 'PERMISSION_SCOPE_KIND_ROOM', id: 'R2' })
    expect(() => toPermissionScope({ roomId: '' })).toThrow(ChattoValidationError)
    expect(() => toPermissionScope({ kind: 'PERMISSION_SCOPE_KIND_GROUP' })).toThrow(ChattoValidationError)
    expect(() => toPermissionScope('dms' as any)).toThrow(ChattoValidationError)
  })

  it('maps friendly decisions and rejects UNSPECIFIED', () => {
    expect(toPermissionDecision('allow')).toBe('PERMISSION_DECISION_ALLOW')
    expect(toPermissionDecision('deny')).toBe('PERMISSION_DECISION_DENY')
    expect(toPermissionDecision('none')).toBe('PERMISSION_DECISION_NONE')
    expect(toPermissionDecision('PERMISSION_DECISION_ALLOW')).toBe('PERMISSION_DECISION_ALLOW')
    expect(() => toPermissionDecision('PERMISSION_DECISION_UNSPECIFIED')).toThrow(ChattoValidationError)
    expect(() => toPermissionDecision('grant' as any)).toThrow(ChattoValidationError)
  })
})

describe('AdminPermissionManager', () => {
  it('setUserPermission() grants several permissions at DM scope (bot use case)', async () => {
    const ctx = makeCtx({})
    ctx.rest.post = mock(async (_s: string, _m: string, body: any, schema: any) =>
      schema.parse({ decision: { permission: body.permission, scope: { kind: 'PERMISSION_SCOPE_KIND_DM' }, decision: body.decision } }),
    )
    const res = await new AdminPermissionManager(ctx).setUserPermission('U_bot', ['message.read', 'message.post'], 'allow', 'dm')
    expect(ctx.rest.post.mock.calls.map((c: any[]) => c.slice(0, 3))).toEqual([
      [SVC, 'SetUserPermission', { userId: 'U_bot', permission: 'message.read', decision: 'PERMISSION_DECISION_ALLOW', scope: DM }],
      [SVC, 'SetUserPermission', { userId: 'U_bot', permission: 'message.post', decision: 'PERMISSION_DECISION_ALLOW', scope: DM }],
    ])
    expect(res).toHaveLength(2)
    expect(res[1]!).toEqual({ permission: 'message.post', scope: { kind: 'PERMISSION_SCOPE_KIND_DM', id: '' }, decision: 'PERMISSION_DECISION_ALLOW' })
  })

  it('setUserPermission() with one permission returns one update; omitted scope = server', async () => {
    // Clearing to NONE: the server echoes the decision; scope SERVER (enum non-zero) is sent explicitly.
    const ctx = makeCtx({ decision: { permission: 'room.join', scope: { kind: 'PERMISSION_SCOPE_KIND_SERVER' }, decision: 'PERMISSION_DECISION_NONE' } })
    const m = new AdminPermissionManager(ctx)
    const res = await m.setUserPermission('U1', 'room.join', 'none')
    expect(lastCall(ctx).slice(0, 3)).toEqual([
      SVC, 'SetUserPermission', { userId: 'U1', permission: 'room.join', decision: 'PERMISSION_DECISION_NONE', scope: undefined },
    ])
    expect(res.decision).toBe('PERMISSION_DECISION_NONE')
    // proto3-omitted decision object
    setReply(ctx, {})
    const empty = await m.setUserPermission('U1', 'room.join', 'allow', { roomId: 'R1' })
    expect(empty).toEqual({ permission: '', scope: { kind: 'PERMISSION_SCOPE_KIND_UNSPECIFIED', id: '' }, decision: 'PERMISSION_DECISION_UNSPECIFIED' })
    expect(lastCall(ctx)[2].scope).toEqual({ kind: 'PERMISSION_SCOPE_KIND_ROOM', id: 'R1' })
  })

  it('setUserPermission() validates before writing anything', async () => {
    const ctx = makeCtx({})
    const m = new AdminPermissionManager(ctx)
    await expect(m.setUserPermission('U1', ['message.read', ''], 'allow')).rejects.toBeInstanceOf(ChattoValidationError)
    await expect(m.setUserPermission('U1', 'message.read', 'maybe' as any)).rejects.toBeInstanceOf(ChattoValidationError)
    await expect(m.setUserPermission('U1', 'message.read', 'allow', { groupId: '' })).rejects.toBeInstanceOf(ChattoValidationError)
    expect(ctx.rest.post).not.toHaveBeenCalled()
    expect(await m.setUserPermission('U1', [], 'allow')).toEqual([])
    expect(ctx.rest.post).not.toHaveBeenCalled()
  })

  it('setRolePermission() sends roleName + scope', async () => {
    const ctx = makeCtx({ decision: { permission: 'message.pin', scope: { kind: 'PERMISSION_SCOPE_KIND_ROOM', id: 'R1' }, decision: 'PERMISSION_DECISION_DENY' } })
    const res = await new AdminPermissionManager(ctx).setRolePermission('moderator', 'message.pin', 'deny', { roomId: 'R1' })
    expect(lastCall(ctx).slice(0, 3)).toEqual([
      SVC, 'SetRolePermission',
      { roleName: 'moderator', permission: 'message.pin', decision: 'PERMISSION_DECISION_DENY', scope: { kind: 'PERMISSION_SCOPE_KIND_ROOM', id: 'R1' } },
    ])
    expect(res.scope.id).toBe('R1')
  })

  it('getRoleTierMatrix() parses tier roles and defaults', async () => {
    const ctx = makeCtx({
      matrix: {
        applicablePermissions: ['message.read', 'message.post'],
        roles: [
          { override: { permissions: ['message.read'] }, inheritedAllows: ['message.post'], role: { name: 'everyone', isSystem: true } },
          { role: { name: 'admin', position: 900 } },
        ],
      },
    })
    const m = new AdminPermissionManager(ctx)
    const tier = await m.getRoleTierMatrix('dm')
    expect(lastCall(ctx).slice(0, 3)).toEqual([SVC, 'GetRolePermissionTierMatrix', { scope: DM }])
    expect(tier.roles[0]!.override).toEqual({ permissions: ['message.read'], permissionDenials: [] })
    expect(tier.roles[1]!.override).toEqual({ permissions: [], permissionDenials: [] })
    expect(tier.roles[1]!.inheritedDenials).toEqual([])
    setReply(ctx, {})
    expect(await m.getRoleTierMatrix()).toEqual({ applicablePermissions: [], roles: [] })
    expect(lastCall(ctx)[2]).toEqual({ scope: undefined })
  })

  it('getRoleMatrix() / getUserMatrix() include DM by default and parse cells', async () => {
    const matrix = {
      applicablePermissions: ['message.read'],
      scopes: [
        { id: 'server', label: 'Server', kind: 'PERMISSION_SCOPE_KIND_SERVER' },
        { id: 'dm', label: 'Direct messages', kind: 'PERMISSION_SCOPE_KIND_DM' },
        { id: 'room:R1', label: 'general', kind: 'PERMISSION_SCOPE_KIND_ROOM', parentGroupId: 'G1' },
      ],
      cells: [
        { permission: 'message.read', scopeId: 'dm', override: 'PERMISSION_DECISION_ALLOW', effective: 'PERMISSION_DECISION_ALLOW', allowPermitted: true },
        { permission: 'message.post', scopeId: 'dm' },
      ],
    }
    const ctx = makeCtx({ matrix: { roleName: 'moderator', ...matrix } })
    const m = new AdminPermissionManager(ctx)
    const role = await m.getRoleMatrix('moderator')
    expect(lastCall(ctx).slice(0, 3)).toEqual([
      SVC, 'GetRolePermissionMatrix', { roleName: 'moderator', includeDirectMessageScope: true, scope: undefined },
    ])
    expect(role.scopes[0]!.parentGroupId).toBe('')
    expect(role.cells[1]).toEqual({ permission: 'message.post', scopeId: 'dm', override: 'PERMISSION_DECISION_UNSPECIFIED', effective: 'PERMISSION_DECISION_UNSPECIFIED' })

    setReply(ctx, { matrix: { userId: 'U_bot', ...matrix } })
    const user = await m.getUserMatrix('U_bot', { scope: 'dm', includeDirectMessageScope: false })
    expect(lastCall(ctx).slice(0, 3)).toEqual([
      SVC, 'GetUserPermissionMatrix', { userId: 'U_bot', includeDirectMessageScope: false, scope: DM },
    ])
    expect(user.cells[0]!.allowPermitted).toBe(true)
    setReply(ctx, {})
    expect(await m.getUserMatrix('U_x')).toEqual({ userId: '', applicablePermissions: [], scopes: [], cells: [] })
  })

  it('listRoleDecisions() / listUserDecisions() page by scope', async () => {
    const ctx = makeCtx({
      roleName: 'moderator',
      decisions: [
        { permission: 'server.manage', scope: { kind: 'PERMISSION_SCOPE_KIND_SERVER' }, override: 'PERMISSION_DECISION_NONE', effective: 'PERMISSION_DECISION_NONE' },
        { permission: 'room.join', scope: { kind: 'PERMISSION_SCOPE_KIND_GROUP', id: 'G1' }, override: 'PERMISSION_DECISION_NONE', effective: 'PERMISSION_DECISION_ALLOW' },
      ],
      page: { totalCount: '9', hasMore: true },
      scopes: [{ kind: 'PERMISSION_SCOPE_KIND_SERVER' }, { kind: 'PERMISSION_SCOPE_KIND_GROUP', id: 'G1' }],
    })
    const m = new AdminPermissionManager(ctx)
    const page = await m.listRoleDecisions('moderator', { limit: 2, offset: 0 })
    expect(lastCall(ctx).slice(0, 3)).toEqual([
      SVC, 'ListRolePermissionDecisions',
      { roleName: 'moderator', includeDirectMessageScope: true, page: { limit: 2, offset: 0 }, scope: undefined },
    ])
    expect(page.totalCount).toBe(9)
    expect(page.hasMore).toBe(true)
    expect(page.scopes[0]).toEqual({ kind: 'PERMISSION_SCOPE_KIND_SERVER', id: '' })
    expect(page.decisions[1]!.effective).toBe('PERMISSION_DECISION_ALLOW')

    setReply(ctx, { userId: 'U_bot' })
    const empty = await m.listUserDecisions('U_bot', { scope: { groupId: 'G1' } })
    expect(lastCall(ctx).slice(0, 3)).toEqual([
      SVC, 'ListUserPermissionDecisions',
      { userId: 'U_bot', includeDirectMessageScope: true, page: undefined, scope: { kind: 'PERMISSION_SCOPE_KIND_GROUP', id: 'G1' } },
    ])
    expect(empty).toEqual({ decisions: [], scopes: [], totalCount: 0, hasMore: false })
    await expect(m.listUserDecisions('U', { limit: 101 })).rejects.toBeInstanceOf(ChattoValidationError)
    await expect(m.listRoleDecisions('r', { limit: 101 })).rejects.toBeInstanceOf(ChattoValidationError)
  })

  it('explain() sends a typed scope and parses traces', async () => {
    const ctx = makeCtx({
      explanations: [
        {
          permission: 'message.post', state: 'PERMISSION_DECISION_ALLOW', decidedAt: 'PERMISSION_DECISION_LEVEL_DM', decidedByRole: 'U_bot',
          trace: [{ level: 'PERMISSION_DECISION_LEVEL_DM', roleName: 'U_bot', decision: 'PERMISSION_DECISION_ALLOW', applied: true }],
        },
        { permission: 'call.start', state: 'PERMISSION_DECISION_DENY', decidedAt: 'PERMISSION_DECISION_LEVEL_SERVER', decidedByRole: '@bot-allowlist', trace: [{ level: 'PERMISSION_DECISION_LEVEL_SERVER', roleName: '@bot-allowlist', decision: 'PERMISSION_DECISION_DENY' }] },
        { permission: 'room.list' },
      ],
    })
    const m = new AdminPermissionManager(ctx)
    const ex = await m.explain('U_bot', 'dm')
    expect(lastCall(ctx).slice(0, 3)).toEqual([SVC, 'ExplainPermissions', { userId: 'U_bot', scope: DM }])
    expect(ex[0]!.trace[0]!.applied).toBe(true)
    expect(ex[1]!.trace[0]!.applied).toBe(false)
    expect(ex[2]).toEqual({
      permission: 'room.list', state: 'PERMISSION_DECISION_UNSPECIFIED', decidedAt: 'PERMISSION_DECISION_LEVEL_UNSPECIFIED',
      decidedByRole: '', trace: [], includedByPermission: '',
    })
    setReply(ctx, {})
    expect(await m.explain('U1')).toEqual([])
    expect(lastCall(ctx)[2]).toEqual({ userId: 'U1', scope: undefined })
  })
})
