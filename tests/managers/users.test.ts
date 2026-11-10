import { describe, it, expect, mock } from 'bun:test'
import { UserManager } from '../../src/managers/users'
import { User } from '../../src/resources/user'
import { ChattoValidationError } from '../../src/errors'

const SVC = 'chatto.api.v1.UserService'

const validMember = {
  user: {
    id: 'user_1',
    login: 'ceraia',
    displayName: 'Ceraia',
    deleted: false,
    presenceStatus: 'PRESENCE_STATUS_OFFLINE' as const,
  },
  roles: ['everyone'],
  createdAt: '2026-01-01T00:00:00Z',
}

// Applies the response schema like the real RestClient.
function makeRestMock(returnValue: unknown) {
  return { post: mock(async (_s: string, _m: string, _i: unknown, schema: any) => schema.parse(returnValue)) }
}

function make(returnValue: unknown) {
  const rest = makeRestMock(returnValue)
  return { rest, manager: new UserManager({ rest } as any) }
}

describe('UserManager', () => {
  describe('.fetch()', () => {
    it('calls GetUser and returns a User', async () => {
      const { rest, manager } = make({ user: validMember })
      const user = await manager.fetch('user_1')
      expect(rest.post).toHaveBeenCalledWith(SVC, 'GetUser', { userId: 'user_1' }, expect.anything())
      expect(user).toBeInstanceOf(User)
      expect(user.id).toBe('user_1')
      expect(user.login).toBe('ceraia')
    })
  })

  describe('.fetchByLogin()', () => {
    it('calls GetUser with login', async () => {
      const { rest, manager } = make({ user: { user: { id: 'U1', login: 'sdktest' } } })
      const user = await manager.fetchByLogin('sdktest')
      expect(rest.post).toHaveBeenCalledWith(SVC, 'GetUser', { login: 'sdktest' }, expect.anything())
      expect(user.id).toBe('U1')
      expect(user.roles).toEqual([])
      expect(user.presenceStatus).toBe('PRESENCE_STATUS_UNSPECIFIED')
    })
  })

  describe('.batchFetch()', () => {
    it('calls BatchGetUsers and returns User[]', async () => {
      const member2 = { ...validMember, user: { ...validMember.user, id: 'user_2', login: '46sx' } }
      const { rest, manager } = make({ users: [validMember, member2] })
      const users = await manager.batchFetch(['user_1', 'user_2'])
      expect(rest.post).toHaveBeenCalledWith(SVC, 'BatchGetUsers', { userIds: ['user_1', 'user_2'] }, expect.anything())
      expect(users).toHaveLength(2)
      expect(users[0]).toBeInstanceOf(User)
      expect(users[1]!.login).toBe('46sx')
    })

    it('short-circuits on empty input', async () => {
      const { rest, manager } = make({})
      expect(await manager.batchFetch([])).toEqual([])
      expect(rest.post).not.toHaveBeenCalled()
    })

    it('rejects more than 100 ids', async () => {
      const { rest, manager } = make({})
      const ids = Array.from({ length: 101 }, (_, i) => `u${i}`)
      await expect(manager.batchFetch(ids)).rejects.toBeInstanceOf(ChattoValidationError)
      expect(rest.post).not.toHaveBeenCalled()
    })

    it('handles an omitted users array', async () => {
      const { manager } = make({})
      expect(await manager.batchFetch(['nope'])).toEqual([])
    })
  })

  describe('.list()', () => {
    it('calls ListUsers with no search and returns User[]', async () => {
      const { rest, manager } = make({ users: [validMember] })
      const users = await manager.list()
      expect(rest.post).toHaveBeenCalledWith(SVC, 'ListUsers', { search: undefined, page: undefined }, expect.anything())
      expect(users).toHaveLength(1)
      expect(users[0]).toBeInstanceOf(User)
    })

    it('passes search term when provided', async () => {
      const { rest, manager } = make({ users: [validMember] })
      await manager.list({ search: 'ceraia' })
      expect(rest.post).toHaveBeenCalledWith(SVC, 'ListUsers', { search: 'ceraia', page: undefined }, expect.anything())
    })

    it('returns [] when the server omits users', async () => {
      const { manager } = make({ page: {} })
      expect(await manager.list({ search: 'nobody' })).toEqual([])
    })
  })

  describe('.listPage()', () => {
    it('sends page options and returns page metadata', async () => {
      const { rest, manager } = make({ users: [validMember], page: { totalCount: '41', hasMore: true } })
      const page = await manager.listPage({ limit: 1, offset: 20 })
      expect(rest.post).toHaveBeenCalledWith(SVC, 'ListUsers', { search: undefined, page: { limit: 1, offset: 20 } }, expect.anything())
      expect(page.totalCount).toBe(41)
      expect(page.hasMore).toBe(true)
      expect(page.items[0]).toBeInstanceOf(User)
    })

    it('rejects limit above 500', async () => {
      const { manager } = make({})
      await expect(manager.listPage({ limit: 501 })).rejects.toBeInstanceOf(ChattoValidationError)
    })
  })

  describe('.updateProfile()', () => {
    it('infers the update mask from given fields', async () => {
      const { rest, manager } = make({ user: { id: 'U1', login: 'newname', displayName: 'New' } })
      const user = await manager.updateProfile('U1', { displayName: 'New', login: 'newname' })
      expect(rest.post).toHaveBeenCalledWith(SVC, 'UpdateUserProfile', { userId: 'U1', displayName: 'New', login: 'newname', updateMask: 'displayName,login' }, expect.anything())
      expect(user.login).toBe('newname')
      expect(user.deactivated).toBe(false)
    })

    it('sends null bio as a reset via the mask', async () => {
      const { rest, manager } = make({ user: { id: 'U1' } })
      await manager.updateProfile('U1', { bio: null })
      expect(rest.post).toHaveBeenCalledWith(SVC, 'UpdateUserProfile', { userId: 'U1', updateMask: 'bio' }, expect.anything())
    })

    it('rejects an empty patch', async () => {
      const { manager } = make({})
      await expect(manager.updateProfile('U1', {})).rejects.toBeInstanceOf(ChattoValidationError)
    })
  })

  describe('avatars', () => {
    it('uploadAvatar sends a base64 ImageUpload', async () => {
      const { rest, manager } = make({ user: { id: 'U1', avatarUrl: 'https://x/a.webp' } })
      const user = await manager.uploadAvatar('U1', { data: new Uint8Array([1, 2, 3]), filename: 'a.png', contentType: 'image/png' })
      expect(rest.post).toHaveBeenCalledWith(SVC, 'UploadAvatar', { userId: 'U1', image: { image: 'AQID', filename: 'a.png', contentType: 'image/png' } }, expect.anything())
      expect(user.avatarUrl).toBe('https://x/a.webp')
    })

    it('uploadAvatar rejects empty images', async () => {
      const { manager } = make({})
      await expect(manager.uploadAvatar('U1', { data: new Uint8Array(), filename: 'a.png' })).rejects.toBeInstanceOf(ChattoValidationError)
    })

    it('deleteAvatar posts DeleteAvatar', async () => {
      const { rest, manager } = make({ user: { id: 'U1' } })
      const user = await manager.deleteAvatar('U1')
      expect(rest.post).toHaveBeenCalledWith(SVC, 'DeleteAvatar', { userId: 'U1' }, expect.anything())
      expect(user.avatarUrl).toBeUndefined()
    })
  })
})
