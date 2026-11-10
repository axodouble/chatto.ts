import { describe, it, expect } from 'bun:test'
import { User } from '../../src/resources/user'

const validMember = {
  user: {
    id: 'user_1',
    login: 'ceraia',
    displayName: 'Ceraia',
    deleted: false,
    avatarUrl: 'https://example.com/avatar.png',
    presenceStatus: 'PRESENCE_STATUS_ONLINE' as const,
    customStatus: { emoji: '🎉', text: 'Celebrating' },
  },
  roles: ['everyone', 'admin'],
  createdAt: '2026-01-01T00:00:00Z',
}

describe('User', () => {
  it('exposes all data properties', () => {
    const user = new User(validMember)
    expect(user.id).toBe('user_1')
    expect(user.login).toBe('ceraia')
    expect(user.displayName).toBe('Ceraia')
    expect(user.deleted).toBe(false)
    expect(user.avatarUrl).toBe('https://example.com/avatar.png')
    expect(user.presenceStatus).toBe('PRESENCE_STATUS_ONLINE')
    expect(user.customStatus?.emoji).toBe('🎉')
    expect(user.roles).toEqual(['everyone', 'admin'])
    expect(user.createdAt).toBe('2026-01-01T00:00:00Z')
  })
})

describe('User discord.js ergonomics', () => {
  const memberData = {
    user: {
      id: 'U_1', login: 'ceraia', displayName: 'Ceraia', deleted: false,
      avatarUrl: 'https://x/a.png', presenceStatus: 'PRESENCE_STATUS_ONLINE',
    },
    roles: ['admin'],
  }

  it('exposes username as an alias of login', () => {
    const user = new User(memberData as any)
    expect(user.username).toBe('ceraia')
  })

  it('User.partial builds a User from just an id', () => {
    const user = User.partial('U_42')
    expect(user.id).toBe('U_42')
    expect(user.displayName).toBe('U_42')
    expect(user.login).toBe('U_42')
  })
})

describe('User v0.5.0 fields', () => {
  it('exposes bio, timezone, bot owner and deactivated', () => {
    const user = new User({
      user: {
        id: 'B1', login: 'bot', displayName: 'Bot', deleted: false, presenceStatus: 'PRESENCE_STATUS_ONLINE',
        bio: 'hi', timezone: 'Europe/Berlin', bot: { ownerUserId: 'U1' }, deactivated: true,
      },
      roles: [],
    } as any)
    expect(user.bio).toBe('hi')
    expect(user.timezone).toBe('Europe/Berlin')
    expect(user.isBot).toBe(true)
    expect(user.botOwnerId).toBe('U1')
    expect(user.deactivated).toBe(true)
  })

  it('humans are not bots', () => {
    const user = User.partial('U_1')
    expect(user.isBot).toBe(false)
    expect(user.botOwnerId).toBeUndefined()
    expect(user.deactivated).toBe(false)
    expect(user.bio).toBeUndefined()
  })
})
