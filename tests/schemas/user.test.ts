import { describe, it, expect } from 'bun:test'
import {
  UserSchema,
  DirectoryMemberSchema,
  GetUserResponseSchema,
  BatchGetUsersResponseSchema,
  ListUsersResponseSchema,
  SetPresenceResponseSchema,
  SetCustomStatusResponseSchema,
  DeleteCustomStatusResponseSchema,
} from '../../src/schemas/user'

const validUser = {
  id: 'user_1',
  login: 'ceraia',
  displayName: 'Ceraia',
  presenceStatus: 'PRESENCE_STATUS_ONLINE',
}

const validMember = {
  user: validUser,
  roles: ['everyone'],
  createdAt: '2026-01-01T00:00:00Z',
}

describe('UserSchema', () => {
  it('parses a minimal user', () => {
    const result = UserSchema.parse(validUser)
    expect(result.id).toBe('user_1')
    expect(result.login).toBe('ceraia')
    expect(result.displayName).toBe('Ceraia')
    expect(result.deleted).toBe(false)
    expect(result.avatarUrl).toBeUndefined()
    expect(result.customStatus).toBeUndefined()
  })

  it('parses a full user with optional fields', () => {
    const full = {
      ...validUser,
      avatarUrl: 'https://example.com/avatar.png',
      customStatus: { emoji: '🎉', text: 'Celebrating', expiresAt: '2026-07-10T00:00:00Z' },
    }
    const result = UserSchema.parse(full)
    expect(result.avatarUrl).toBe('https://example.com/avatar.png')
    expect(result.customStatus?.emoji).toBe('🎉')
    expect(result.customStatus?.text).toBe('Celebrating')
  })

  it('defaults deleted to false when absent', () => {
    const result = UserSchema.parse(validUser)
    expect(result.deleted).toBe(false)
  })
})

describe('DirectoryMemberSchema', () => {
  it('parses a full member', () => {
    const result = DirectoryMemberSchema.parse(validMember)
    expect(result.user.id).toBe('user_1')
    expect(result.roles).toEqual(['everyone'])
    expect(result.createdAt).toBe('2026-01-01T00:00:00Z')
  })

  it('defaults roles to empty array when absent', () => {
    const result = DirectoryMemberSchema.parse({ user: validUser })
    expect(result.roles).toEqual([])
  })
})

describe('GetUserResponseSchema', () => {
  it('parses correctly', () => {
    const result = GetUserResponseSchema.parse({ user: validMember })
    expect(result.user.user.id).toBe('user_1')
  })
})

describe('BatchGetUsersResponseSchema', () => {
  it('parses correctly', () => {
    const result = BatchGetUsersResponseSchema.parse({ users: [validMember] })
    expect(result.users).toHaveLength(1)
    expect(result.users[0].user.id).toBe('user_1')
  })

  // proto3 JSON omits empty repeated fields, so an all-empty result has no `users` key.
  it('defaults users to empty array when absent', () => {
    const result = BatchGetUsersResponseSchema.parse({})
    expect(result.users).toEqual([])
  })
})

describe('ListUsersResponseSchema', () => {
  it('parses correctly', () => {
    const result = ListUsersResponseSchema.parse({ users: [validMember] })
    expect(result.users).toHaveLength(1)
    expect(result.users[0].user.id).toBe('user_1')
  })

  // A search that matches nobody comes back as `{ page: {} }` — the server omits
  // the empty `users` array entirely (proto3 JSON behavior).
  it('defaults users to empty array when the server omits it (no results)', () => {
    const result = ListUsersResponseSchema.parse({ page: {} })
    expect(result.users).toEqual([])
  })
})

describe('status response schemas', () => {
  it('parses SetPresenceResponse', () => {
    const parsed = SetPresenceResponseSchema.parse({ status: 'PRESENCE_STATUS_ONLINE' })
    expect(parsed.status).toBe('PRESENCE_STATUS_ONLINE')
  })

  it('parses SetCustomStatusResponse', () => {
    const parsed = SetCustomStatusResponseSchema.parse({
      status: { emoji: '🎧', text: 'listening', expiresAt: '2026-07-15T12:00:00Z' },
    })
    expect(parsed.status.emoji).toBe('🎧')
    expect(parsed.status.text).toBe('listening')
  })

  it('parses DeleteCustomStatusResponse with absent status', () => {
    const parsed = DeleteCustomStatusResponseSchema.parse({})
    expect(parsed.status).toBeUndefined()
  })
})
