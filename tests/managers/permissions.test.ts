import { describe, it, expect, mock } from 'bun:test'
import { ChattoValidationError } from '../../src/errors'

// Applies the response schema like the real RestClient.
function makeRestMock(returnValue: unknown) {
  return { post: mock(async (_s: string, _m: string, _i: unknown, schema: any) => schema.parse(returnValue)) }
}

import { PermissionManager } from '../../src/managers/permissions'

describe('PermissionManager', () => {
  it('listEffective posts ListEffectivePermissions and parses scopes', async () => {
    const rest = makeRestMock({
      permissions: [
        { permission: 'message.post', scope: { kind: 'EFFECTIVE_PERMISSION_SCOPE_KIND_SERVER' }, coversDescendants: true },
        { permission: 'message.pin', scope: { kind: 'EFFECTIVE_PERMISSION_SCOPE_KIND_ROOM', id: 'R1', name: 'general', parentGroupId: 'G1' } },
        { permission: 'x.y' },
      ],
    })
    const perms = await new PermissionManager({ rest } as any).listEffective('B1')
    expect(rest.post).toHaveBeenCalledWith('chatto.api.v1.PermissionService', 'ListEffectivePermissions', { userId: 'B1' }, expect.anything())
    expect(perms[0]).toEqual({ permission: 'message.post', scope: { kind: 'EFFECTIVE_PERMISSION_SCOPE_KIND_SERVER', id: '', name: '', parentGroupId: '' }, coversDescendants: true })
    expect(perms[1]!.scope.parentGroupId).toBe('G1')
    expect(perms[2]!.scope.kind).toBe('EFFECTIVE_PERMISSION_SCOPE_KIND_UNSPECIFIED')
  })

  it('listEffective returns [] for an empty response', async () => {
    const rest = makeRestMock({})
    expect(await new PermissionManager({ rest } as any).listEffective('B1')).toEqual([])
  })
})
