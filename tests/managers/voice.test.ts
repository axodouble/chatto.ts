import { describe, it, expect, mock } from 'bun:test'
import { ChattoValidationError } from '../../src/errors'

// Applies the response schema like the real RestClient.
function makeRestMock(returnValue: unknown) {
  return { post: mock(async (_s: string, _m: string, _i: unknown, schema: any) => schema.parse(returnValue)) }
}

import { VoiceCallManager } from '../../src/managers/voice'

const SVC = 'chatto.api.v1.VoiceCallService'
const make = (v: unknown) => { const rest = makeRestMock(v); return { rest, manager: new VoiceCallManager({ rest } as any) } }

const call = {
  room: { id: 'R1', kind: 'ROOM_KIND_CHANNEL', name: 'general' },
  callId: 'C1',
  participants: [{ user: { id: 'U1', login: 'a' }, joinedAt: '2026-11-10T00:00:00Z', callId: 'C1' }],
}

describe('VoiceCallManager', () => {
  it('listActiveCalls parses calls', async () => {
    const { rest, manager } = make({ calls: [call] })
    const calls = await manager.listActiveCalls()
    expect(rest.post).toHaveBeenCalledWith(SVC, 'ListActiveCalls', {}, expect.anything())
    expect(calls[0]!.room?.kind).toBe('ROOM_KIND_CHANNEL')
    expect(calls[0]!.participants[0]!.user?.displayName).toBe('')
  })

  it('listActiveCalls returns [] for an empty response', async () => {
    const { manager } = make({})
    expect(await manager.listActiveCalls()).toEqual([])
  })

  it('fetchActiveCall posts GetActiveCall', async () => {
    const { rest, manager } = make({ call: { room: { id: 'R2' } } })
    const c = await manager.fetchActiveCall('R2')
    expect(rest.post).toHaveBeenCalledWith(SVC, 'GetActiveCall', { roomId: 'R2' }, expect.anything())
    expect(c.callId).toBe('')
    expect(c.participants).toEqual([])
    expect(c.room).toEqual({ id: 'R2', kind: 'ROOM_KIND_UNSPECIFIED', name: '' })
  })

  it('batchFetchActiveCalls posts and validates', async () => {
    const { rest, manager } = make({})
    expect(await manager.batchFetchActiveCalls(['R1'])).toEqual([])
    expect(rest.post).toHaveBeenCalledWith(SVC, 'BatchGetActiveCalls', { roomIds: ['R1'] }, expect.anything())
    expect(await manager.batchFetchActiveCalls([])).toEqual([])
    await expect(manager.batchFetchActiveCalls(Array.from({ length: 101 }, (_, i) => `R${i}`))).rejects.toBeInstanceOf(ChattoValidationError)
    expect(rest.post).toHaveBeenCalledTimes(1)
  })

  it('listParticipants posts ListCallParticipants', async () => {
    const { rest, manager } = make({})
    expect(await manager.listParticipants('R1')).toEqual([])
    expect(rest.post).toHaveBeenCalledWith(SVC, 'ListCallParticipants', { roomId: 'R1' }, expect.anything())
  })

  it('join / leave return the recorded flag, false when omitted', async () => {
    const a = make({ joined: true })
    expect(await a.manager.join('R1')).toBe(true)
    expect(a.rest.post).toHaveBeenCalledWith(SVC, 'JoinCall', { roomId: 'R1' }, expect.anything())
    const b = make({})
    expect(await b.manager.leave('R1')).toBe(false)
    expect(b.rest.post).toHaveBeenCalledWith(SVC, 'LeaveCall', { roomId: 'R1' }, expect.anything())
  })

  it('createToken returns token, e2eeKey and callId', async () => {
    const { rest, manager } = make({ token: 'jwt', e2eeKey: 'k', callId: 'C1' })
    expect(await manager.createToken('R1')).toEqual({ token: 'jwt', e2eeKey: 'k', callId: 'C1' })
    expect(rest.post).toHaveBeenCalledWith(SVC, 'CreateCallToken', { roomId: 'R1' }, expect.anything())
  })

  it('createMediaPublisherToken maps the friendly kind', async () => {
    const { rest, manager } = make({ token: 'jwt' })
    const t = await manager.createMediaPublisherToken('R1')
    expect(rest.post).toHaveBeenCalledWith(SVC, 'CreateCallMediaPublisherToken', { roomId: 'R1', kind: 'CALL_MEDIA_PUBLISHER_KIND_GAME_SHARE' }, expect.anything())
    expect(t.e2eeKey).toBe('')
  })
})
