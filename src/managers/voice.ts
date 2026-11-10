import type { ClientContext } from '../context'
import { ChattoValidationError } from '../errors'
import {
  ActiveCallsResponseSchema,
  GetActiveCallResponseSchema,
  ListCallParticipantsResponseSchema,
  JoinCallResponseSchema,
  LeaveCallResponseSchema,
  CallTokenSchema,
  type ActiveCall,
  type CallParticipant,
  type CallToken,
  type CallMediaPublisherKind,
} from '../schemas/voice'

const SERVICE = 'chatto.api.v1.VoiceCallService'

/** Companion publisher kind: friendly `'game_share'` or the raw proto name. */
export type CallMediaPublisherKindInput = 'game_share' | Exclude<CallMediaPublisherKind, 'CALL_MEDIA_PUBLISHER_KIND_UNSPECIFIED'>

/**
 * Room-scoped voice/video calls (`chatto.api.v1.VoiceCallService`). Media
 * itself flows through LiveKit using the tokens issued here.
 */
export class VoiceCallManager {
  constructor(private readonly ctx: ClientContext) {}

  /** List active calls in rooms you are a member of. Empty when LiveKit is not configured. */
  async listActiveCalls(): Promise<ActiveCall[]> {
    const res = await this.ctx.rest.post(SERVICE, 'ListActiveCalls', {}, ActiveCallsResponseSchema)
    return res.calls
  }

  /**
   * Fetch a room's active call. NOT_FOUND when the room has no active call (or
   * calls are not configured). Use `callId` to ignore stale realtime call events.
   */
  async fetchActiveCall(roomId: string): Promise<ActiveCall> {
    const res = await this.ctx.rest.post(SERVICE, 'GetActiveCall', { roomId }, GetActiveCallResponseSchema)
    return res.call
  }

  /**
   * Fetch active calls for up to 100 rooms. Rooms without an active call or
   * not accessible are omitted. Empty input returns `[]`.
   */
  async batchFetchActiveCalls(roomIds: string[]): Promise<ActiveCall[]> {
    if (roomIds.length === 0) return []
    if (roomIds.length > 100) {
      throw new ChattoValidationError('too_many_room_ids', 'At most 100 room IDs may be fetched at once')
    }
    const res = await this.ctx.rest.post(SERVICE, 'BatchGetActiveCalls', { roomIds }, ActiveCallsResponseSchema)
    return res.calls
  }

  /** List participants currently in a room's call. Requires room membership. */
  async listParticipants(roomId: string): Promise<CallParticipant[]> {
    const res = await this.ctx.rest.post(SERVICE, 'ListCallParticipants', { roomId }, ListCallParticipantsResponseSchema)
    return res.participants
  }

  /**
   * Record intent to join a room's call (starts one if none is active; needs
   * `call.join`, plus `call.start` to start). Returns false when LiveKit is not configured.
   */
  async join(roomId: string): Promise<boolean> {
    const res = await this.ctx.rest.post(SERVICE, 'JoinCall', { roomId }, JoinCallResponseSchema)
    return res.joined
  }

  /**
   * Issue a LiveKit JWT (valid 5 minutes) plus the call's E2EE key for joining
   * the active call. FAILED_PRECONDITION when no call is active.
   */
  async createToken(roomId: string): Promise<CallToken> {
    return this.ctx.rest.post(SERVICE, 'CreateCallToken', { roomId }, CallTokenSchema)
  }

  /**
   * Issue a 1-minute LiveKit token for a native companion publisher (e.g. game
   * share) attached to your participant. Requires having joined the call and
   * `call.screenshare`.
   */
  async createMediaPublisherToken(
    roomId: string,
    kind: CallMediaPublisherKindInput = 'game_share',
  ): Promise<CallToken> {
    const wireKind = kind === 'game_share' ? 'CALL_MEDIA_PUBLISHER_KIND_GAME_SHARE' : kind
    return this.ctx.rest.post(
      SERVICE,
      'CreateCallMediaPublisherToken',
      { roomId, kind: wireKind },
      CallTokenSchema,
    )
  }

  /** Record intent to leave a room's call. Returns false when LiveKit is not configured. */
  async leave(roomId: string): Promise<boolean> {
    const res = await this.ctx.rest.post(SERVICE, 'LeaveCall', { roomId }, LeaveCallResponseSchema)
    return res.left
  }
}
