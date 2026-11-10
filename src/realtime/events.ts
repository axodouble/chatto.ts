import type { RealtimeEvent, RealtimeEventPayloads } from './generated'
import type { MessageDeleteEvent, ReactionEvent } from '../types'

export type RealtimeEventName = keyof RealtimeEventPayloads

/** Envelope metadata delivered alongside every typed realtime event. */
export interface RealtimeEventMeta {
  /** Universal event id. For `messagePosted` this is the message's event id. */
  id: string
  createdAt?: string
  /** User that caused the event; absent for system events. */
  actorId?: string
  /** Resume cursor, when the event is replayable. */
  cursor?: string
}

/** A decoded realtime event reduced to its variant name and payload. */
export interface TypedRealtimeEvent<K extends RealtimeEventName = RealtimeEventName> {
  name: K
  payload: RealtimeEventPayloads[K]
  meta: RealtimeEventMeta
}

/** Convenience events the client derives (and hydrates) from realtime events. */
export type SdkEvent =
  | { kind: 'messageCreate'; roomId: string; messageEventId: string }
  | { kind: 'messageUpdate'; roomId: string; messageEventId: string }
  | { kind: 'messageDelete'; event: MessageDeleteEvent }
  | { kind: 'reactionAdd'; event: ReactionEvent }
  | { kind: 'reactionRemove'; event: ReactionEvent }

export function toTypedEvent(event: RealtimeEvent): TypedRealtimeEvent | null {
  const name = event.event
  if (name == null) return null
  const payload = event[name]
  if (payload == null) return null
  return {
    name,
    payload,
    meta: { id: event.id, createdAt: event.createdAt, actorId: event.actorId, cursor: event.cursor },
  } as TypedRealtimeEvent
}

export function mapRealtimeEvent(event: RealtimeEvent): SdkEvent | null {
  const actorId = event.actorId || undefined
  if (event.messagePosted != null) {
    return { kind: 'messageCreate', roomId: event.messagePosted.roomId, messageEventId: event.id }
  }
  if (event.messageEdited != null) {
    return { kind: 'messageUpdate', roomId: event.messageEdited.roomId, messageEventId: event.messageEdited.messageEventId }
  }
  if (event.messageRetracted != null) {
    return {
      kind: 'messageDelete',
      event: { roomId: event.messageRetracted.roomId, eventId: event.messageRetracted.messageEventId, actorId },
    }
  }
  if (event.reactionAdded != null) {
    const { roomId, messageEventId, emoji } = event.reactionAdded
    return { kind: 'reactionAdd', event: { roomId, messageEventId, emoji, actorId } }
  }
  if (event.reactionRemoved != null) {
    const { roomId, messageEventId, emoji } = event.reactionRemoved
    return { kind: 'reactionRemove', event: { roomId, messageEventId, emoji, actorId } }
  }
  return null
}
