import { describe, it, expect } from 'bun:test'
import { normalizePresence, serializeExpiresAt } from '../../src/account/presence'
import { ChattoValidationError } from '../../src/errors'

describe('normalizePresence', () => {
  it('maps friendly names to enum names', () => {
    expect(normalizePresence('online')).toBe('PRESENCE_STATUS_ONLINE')
    expect(normalizePresence('away')).toBe('PRESENCE_STATUS_AWAY')
    expect(normalizePresence('dnd')).toBe('PRESENCE_STATUS_DO_NOT_DISTURB')
  })

  it('maps discord aliases', () => {
    expect(normalizePresence('idle')).toBe('PRESENCE_STATUS_AWAY')
    expect(normalizePresence('invisible')).toBe('OFFLINE')
  })

  it('returns the OFFLINE sentinel for offline', () => {
    expect(normalizePresence('offline')).toBe('OFFLINE')
  })

  it('throws ChattoValidationError on unknown input', () => {
    expect(() => normalizePresence('busy' as any)).toThrow(ChattoValidationError)
  })
})

describe('serializeExpiresAt', () => {
  it('passes strings through', () => {
    expect(serializeExpiresAt('2026-07-15T12:00:00Z')).toBe('2026-07-15T12:00:00Z')
  })

  it('converts Date to ISO string', () => {
    const d = new Date('2026-07-15T12:00:00.000Z')
    expect(serializeExpiresAt(d)).toBe('2026-07-15T12:00:00.000Z')
  })

  it('returns undefined for undefined', () => {
    expect(serializeExpiresAt(undefined)).toBeUndefined()
  })
})

describe('toPresenceStatus', () => {
  it('maps friendly names, mapping offline/invisible to the real OFFLINE value', async () => {
    const { toPresenceStatus } = await import('../../src/account/presence')
    expect(toPresenceStatus('online')).toBe('PRESENCE_STATUS_ONLINE')
    expect(toPresenceStatus('idle')).toBe('PRESENCE_STATUS_AWAY')
    expect(toPresenceStatus('invisible')).toBe('PRESENCE_STATUS_OFFLINE')
    expect(toPresenceStatus('offline')).toBe('PRESENCE_STATUS_OFFLINE')
  })

  it('passes raw proto names through and rejects garbage', async () => {
    const { toPresenceStatus } = await import('../../src/account/presence')
    expect(toPresenceStatus('PRESENCE_STATUS_DO_NOT_DISTURB')).toBe('PRESENCE_STATUS_DO_NOT_DISTURB')
    expect(() => toPresenceStatus('PRESENCE_STATUS_UNSPECIFIED' as any)).toThrow(ChattoValidationError)
  })
})
