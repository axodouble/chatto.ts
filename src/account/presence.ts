import { ChattoValidationError } from '../errors'
import type { PresenceInput } from '../types'
import type { PresenceStatusSchema } from '../schemas/user'
import type { z } from 'zod'

type PresenceStatusName = z.infer<typeof PresenceStatusSchema>

const PRESENCE_MAP: Record<PresenceInput, PresenceStatusName | 'OFFLINE'> = {
  online: 'PRESENCE_STATUS_ONLINE',
  away: 'PRESENCE_STATUS_AWAY',
  idle: 'PRESENCE_STATUS_AWAY',
  dnd: 'PRESENCE_STATUS_DO_NOT_DISTURB',
  offline: 'OFFLINE',
  invisible: 'OFFLINE',
}

export function normalizePresence(input: PresenceInput): PresenceStatusName | 'OFFLINE' {
  const mapped = PRESENCE_MAP[input]
  if (mapped == null) {
    throw new ChattoValidationError(
      'invalid_presence',
      `Invalid presence status: ${String(input)}. Expected one of ${Object.keys(PRESENCE_MAP).join(', ')}.`,
    )
  }
  return mapped
}

export function serializeExpiresAt(value: Date | string | undefined): string | undefined {
  if (value == null) return undefined
  return value instanceof Date ? value.toISOString() : value
}

const PRESENCE_STATUS_NAMES: readonly PresenceStatusName[] = [
  'PRESENCE_STATUS_ONLINE',
  'PRESENCE_STATUS_AWAY',
  'PRESENCE_STATUS_DO_NOT_DISTURB',
  'PRESENCE_STATUS_OFFLINE',
]

/**
 * Friendly (`'online' | 'away' | 'idle' | 'dnd' | 'offline' | 'invisible'`) or
 * raw proto (`'PRESENCE_STATUS_*'`) presence status input.
 */
export type PresenceStatusInput = PresenceInput | Exclude<PresenceStatusName, 'PRESENCE_STATUS_UNSPECIFIED'>

/**
 * Map a friendly or raw presence status to the proto enum name. Unlike
 * `normalizePresence`, offline/invisible map to the real
 * `PRESENCE_STATUS_OFFLINE` value (valid for SetPresencePreference).
 */
export function toPresenceStatus(input: PresenceStatusInput): Exclude<PresenceStatusName, 'PRESENCE_STATUS_UNSPECIFIED'> {
  if ((PRESENCE_STATUS_NAMES as readonly string[]).includes(input)) {
    return input as Exclude<PresenceStatusName, 'PRESENCE_STATUS_UNSPECIFIED'>
  }
  const mapped = normalizePresence(input as PresenceInput)
  return mapped === 'OFFLINE' ? 'PRESENCE_STATUS_OFFLINE' : (mapped as Exclude<PresenceStatusName, 'PRESENCE_STATUS_UNSPECIFIED'>)
}
