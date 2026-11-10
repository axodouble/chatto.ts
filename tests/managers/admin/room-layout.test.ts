import { describe, it, expect, mock } from 'bun:test'
import { AdminRoomLayoutManager } from '../../../src/managers/admin/room-layout'
import { Room } from '../../../src/resources/room'
import { ChattoValidationError } from '../../../src/errors'

const SVC = 'chatto.admin.v1.AdminRoomLayoutService'

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
const roomWire = {
  id: 'RHvpiLQqK0rd6d2', kind: 'ROOM_KIND_CHANNEL', name: 'sdk-tests', description: 'Chatto.ts live tests',
  groupId: 'GNizH69iOl1V6V6', threadingMode: 'ROOM_THREADING_MODE_ENABLED', threadSlowModeSeconds: 0,
  createdAt: '2026-11-10T00:15:09.637021462Z', showMembershipEvents: true,
}
const linkWire = { id: 'L09S1tHLGCyjQLG', label: 'y', url: 'https://example.com' }
const groupWire = {
  id: 'GNizH69iOl1V6V6', name: 'Lobby',
  items: [{ room: roomWire }, { sidebarLink: linkWire }],
  canCreateRoom: true,
}
// proto3 JSON omits description, items and canCreateRoom when zero.
const bareGroup = { id: 'G_bare' }

describe('AdminRoomLayoutManager', () => {
  it('getRoom() returns a Room plus capability flags', async () => {
    const ctx = makeCtx({ room: roomWire, viewerCanManageRoom: true, viewerCanManagePermissions: true })
    const res = await new AdminRoomLayoutManager(ctx).getRoom('RHvpiLQqK0rd6d2')
    expect(lastCall(ctx).slice(0, 3)).toEqual([SVC, 'GetRoom', { roomId: 'RHvpiLQqK0rd6d2' }])
    expect(res.room).toBeInstanceOf(Room)
    expect(res.room.name).toBe('sdk-tests')
    expect(res.viewerCanManageRoom).toBe(true)

    ctx.reply = { room: { id: 'R_x' } }
    const bare = await new AdminRoomLayoutManager(ctx).getRoom('R_x')
    expect(bare.viewerCanManageRoom).toBe(false)
    expect(bare.viewerCanManagePermissions).toBe(false)
    expect(bare.room.archived).toBe(false)
  })

  it('getGroup() defaults omitted fields', async () => {
    const ctx = makeCtx({ group: bareGroup })
    const res = await new AdminRoomLayoutManager(ctx).getGroup('G_bare')
    expect(lastCall(ctx).slice(0, 3)).toEqual([SVC, 'GetRoomGroup', { groupId: 'G_bare' }])
    expect(res).toEqual({
      group: { id: 'G_bare', name: '', description: '', items: [], canCreateRoom: false },
      viewerCanManageGroup: false,
      viewerCanManagePermissions: false,
    })
  })

  it('listGroups() parses mixed items and an empty response', async () => {
    const ctx = makeCtx({ groups: [groupWire] })
    const groups = await new AdminRoomLayoutManager(ctx).listGroups()
    expect(lastCall(ctx).slice(0, 3)).toEqual([SVC, 'ListRoomGroups', {}])
    expect(groups[0]!.items[0]!.room!.kind).toBe('ROOM_KIND_CHANNEL')
    expect(groups[0]!.items[1]!.sidebarLink).toEqual(linkWire)
    expect(groups[0]!.canCreateRoom).toBe(true)

    ctx.reply = {}
    expect(await new AdminRoomLayoutManager(ctx).listGroups()).toEqual([])
  })

  it('createGroup() sends name/description and validates lengths', async () => {
    const ctx = makeCtx({ group: { id: 'G1', name: 'New', canCreateRoom: true } })
    const m = new AdminRoomLayoutManager(ctx)
    const g = await m.createGroup({ name: 'New' })
    expect(lastCall(ctx).slice(0, 3)).toEqual([SVC, 'CreateRoomGroup', { name: 'New', description: undefined }])
    expect(g.items).toEqual([])
    await m.createGroup({ name: 'New', description: 'desc' })
    expect(lastCall(ctx)[2]).toEqual({ name: 'New', description: 'desc' })
    await expect(m.createGroup({ name: '' })).rejects.toBeInstanceOf(ChattoValidationError)
    await expect(m.createGroup({ name: 'x'.repeat(81) })).rejects.toBeInstanceOf(ChattoValidationError)
    await expect(m.createGroup({ name: 'ok', description: 'x'.repeat(501) })).rejects.toBeInstanceOf(ChattoValidationError)
  })

  it('updateGroup() infers the mask, sends nulls as absent, and rejects empty updates', async () => {
    const ctx = makeCtx({ group: bareGroup })
    const m = new AdminRoomLayoutManager(ctx)
    await m.updateGroup('G1', { name: 'Renamed', description: null })
    expect(lastCall(ctx).slice(0, 3)).toEqual([
      SVC, 'UpdateRoomGroup', { groupId: 'G1', name: 'Renamed', updateMask: 'name,description' },
    ])
    await m.updateGroup('G1', { description: '' }, { updateMask: '*' })
    expect(lastCall(ctx)[2]).toEqual({ groupId: 'G1', description: '', updateMask: '*' })
    await expect(m.updateGroup('G1', {})).rejects.toBeInstanceOf(ChattoValidationError)
  })

  it('deleteGroup() parses the empty response', async () => {
    const ctx = makeCtx({})
    await expect(new AdminRoomLayoutManager(ctx).deleteGroup('G1')).resolves.toBeUndefined()
    expect(lastCall(ctx).slice(0, 3)).toEqual([SVC, 'DeleteRoomGroup', { groupId: 'G1' }])
  })

  it('reorderGroups() sends the order and enforces 1–1000 ids', async () => {
    const ctx = makeCtx({ groups: [bareGroup] })
    const m = new AdminRoomLayoutManager(ctx)
    const groups = await m.reorderGroups(['G2', 'G1'])
    expect(lastCall(ctx).slice(0, 3)).toEqual([SVC, 'ReorderRoomGroups', { orderedGroupIds: ['G2', 'G1'] }])
    expect(groups[0]!.name).toBe('')
    await expect(m.reorderGroups([])).rejects.toBeInstanceOf(ChattoValidationError)
    await expect(m.reorderGroups(Array.from({ length: 1001 }, (_, i) => `G${i}`))).rejects.toBeInstanceOf(
      ChattoValidationError,
    )
    expect(ctx.rest.post).toHaveBeenCalledTimes(1)
  })

  it('moveGroup() sends beforeGroupId only when given', async () => {
    const ctx = makeCtx({})
    const m = new AdminRoomLayoutManager(ctx)
    expect(await m.moveGroup('G1', 'G0')).toEqual([])
    expect(lastCall(ctx).slice(0, 3)).toEqual([SVC, 'MoveRoomGroup', { groupId: 'G1', beforeGroupId: 'G0' }])
    await m.moveGroup('G1')
    expect(lastCall(ctx)[2]).toEqual({ groupId: 'G1', beforeGroupId: undefined })
  })

  it('moveRoomToGroup() returns a Room', async () => {
    const ctx = makeCtx({ room: roomWire })
    const room = await new AdminRoomLayoutManager(ctx).moveRoomToGroup('RHvpiLQqK0rd6d2', 'G2')
    expect(lastCall(ctx).slice(0, 3)).toEqual([SVC, 'MoveRoomToGroup', { roomId: 'RHvpiLQqK0rd6d2', groupId: 'G2' }])
    expect(room).toBeInstanceOf(Room)
    expect(room.groupId).toBe('GNizH69iOl1V6V6')
  })

  it('reorderItems() encodes oneof refs flat and validates them', async () => {
    const ctx = makeCtx({ group: groupWire })
    const m = new AdminRoomLayoutManager(ctx)
    const g = await m.reorderItems('G1', [{ sidebarLinkId: 'L1' }, { roomId: 'R1' }])
    expect(lastCall(ctx).slice(0, 3)).toEqual([
      SVC, 'ReorderSidebarItemsInGroup', { groupId: 'G1', items: [{ sidebarLinkId: 'L1' }, { roomId: 'R1' }] },
    ])
    expect(g.items).toHaveLength(2)
    await expect(m.reorderItems('G1', [{ roomId: '' }])).rejects.toBeInstanceOf(ChattoValidationError)
    await expect(
      m.reorderItems('G1', Array.from({ length: 1001 }, (_, i) => ({ roomId: `R${i}` }))),
    ).rejects.toBeInstanceOf(ChattoValidationError)
  })

  it('moveItem() sends item, group and optional before', async () => {
    const ctx = makeCtx({ group: bareGroup })
    const m = new AdminRoomLayoutManager(ctx)
    await m.moveItem({ sidebarLinkId: 'L1' }, 'G1', { roomId: 'R1' })
    expect(lastCall(ctx).slice(0, 3)).toEqual([
      SVC, 'MoveSidebarItem', { item: { sidebarLinkId: 'L1' }, groupId: 'G1', before: { roomId: 'R1' } },
    ])
    await m.moveItem({ roomId: 'R1' }, 'G1')
    expect(lastCall(ctx)[2]).toEqual({ item: { roomId: 'R1' }, groupId: 'G1', before: undefined })
  })

  it('createSidebarLink() sends label/url and validates lengths', async () => {
    const ctx = makeCtx({ sidebarLink: { id: 'L1' } })
    const m = new AdminRoomLayoutManager(ctx)
    const link = await m.createSidebarLink('G1', { label: 'Docs', url: '/docs' })
    expect(lastCall(ctx).slice(0, 3)).toEqual([SVC, 'CreateSidebarLink', { groupId: 'G1', label: 'Docs', url: '/docs' }])
    expect(link).toEqual({ id: 'L1', label: '', url: '' })
    await expect(m.createSidebarLink('G1', { label: '', url: '/x' })).rejects.toBeInstanceOf(ChattoValidationError)
    await expect(m.createSidebarLink('G1', { label: 'x', url: 'u'.repeat(2049) })).rejects.toBeInstanceOf(
      ChattoValidationError,
    )
  })

  it('updateSidebarLink() infers the mask', async () => {
    const ctx = makeCtx({ sidebarLink: linkWire })
    const m = new AdminRoomLayoutManager(ctx)
    const link = await m.updateSidebarLink('L1', { label: 'y' })
    expect(lastCall(ctx).slice(0, 3)).toEqual([SVC, 'UpdateSidebarLink', { linkId: 'L1', label: 'y', updateMask: 'label' }])
    expect(link.label).toBe('y')
    await expect(m.updateSidebarLink('L1', {})).rejects.toBeInstanceOf(ChattoValidationError)
  })

  it('deleteSidebarLink() and moveSidebarLinkToGroup()', async () => {
    const ctx = makeCtx({})
    const m = new AdminRoomLayoutManager(ctx)
    await expect(m.deleteSidebarLink('L1')).resolves.toBeUndefined()
    expect(lastCall(ctx).slice(0, 3)).toEqual([SVC, 'DeleteSidebarLink', { linkId: 'L1' }])
    ctx.reply = { sidebarLink: linkWire }
    const link = await m.moveSidebarLinkToGroup('L1', 'G2')
    expect(lastCall(ctx).slice(0, 3)).toEqual([SVC, 'MoveSidebarLinkToGroup', { linkId: 'L1', groupId: 'G2' }])
    expect(link.id).toBe('L09S1tHLGCyjQLG')
  })
})
