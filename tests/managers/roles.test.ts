import { describe, it, expect, mock } from 'bun:test'
import { ChattoValidationError } from '../../src/errors'

// Applies the response schema like the real RestClient.
function makeRestMock(returnValue: unknown) {
  return { post: mock(async (_s: string, _m: string, _i: unknown, schema: any) => schema.parse(returnValue)) }
}

import { RoleManager } from '../../src/managers/roles'

const SVC = 'chatto.api.v1.RoleService'
const make = (v: unknown) => { const rest = makeRestMock(v); return { rest, manager: new RoleManager({ rest } as any) } }

describe('RoleManager', () => {
  it('list parses the live-shaped catalog with defaults', async () => {
    const { rest, manager } = make({ roles: [
      { name: 'everyone', displayName: 'Everyone', description: 'All authenticated users', isSystem: true },
      { name: 'moderator', displayName: 'Moderator', isSystem: true, position: 100, pingable: true },
    ] })
    const roles = await manager.list()
    expect(rest.post).toHaveBeenCalledWith(SVC, 'ListRoles', {}, expect.anything())
    expect(roles[0]).toEqual({ name: 'everyone', displayName: 'Everyone', description: 'All authenticated users', isSystem: true, position: 0, pingable: false })
    expect(roles[1]!.pingable).toBe(true)
  })

  it('list returns [] for an empty response', async () => {
    const { manager } = make({})
    expect(await manager.list()).toEqual([])
  })

  it('fetch posts GetRole', async () => {
    const { rest, manager } = make({ role: { name: 'owner' } })
    const role = await manager.fetch('owner')
    expect(rest.post).toHaveBeenCalledWith(SVC, 'GetRole', { name: 'owner' }, expect.anything())
    expect(role.displayName).toBe('')
  })

  it('batchFetch posts BatchGetRoles', async () => {
    const { rest, manager } = make({ roles: [{ name: 'owner' }] })
    expect(await manager.batchFetch(['owner', 'x'])).toHaveLength(1)
    expect(rest.post).toHaveBeenCalledWith(SVC, 'BatchGetRoles', { names: ['owner', 'x'] }, expect.anything())
  })

  it('batchFetch short-circuits and enforces the limit', async () => {
    const { rest, manager } = make({})
    expect(await manager.batchFetch([])).toEqual([])
    await expect(manager.batchFetch(Array.from({ length: 101 }, (_, i) => `r${i}`))).rejects.toBeInstanceOf(ChattoValidationError)
    expect(rest.post).not.toHaveBeenCalled()
  })
})
