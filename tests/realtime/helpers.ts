import { EventEmitter } from 'events'
import protobuf from 'protobufjs'
import descriptor from '../../src/realtime/descriptor.json'

const root = protobuf.Root.fromJSON(descriptor as protobuf.INamespace)

/** Encode a server frame from a protobufjs plain object (camelCase, enum names, Timestamp as {seconds,nanos}). */
export function encodeServerFrame(obj: object): Buffer {
  const T = root.lookupType('chatto.realtime.v1.RealtimeServerFrame')
  return Buffer.from(T.encode(T.fromObject(obj)).finish())
}

/** Decode a client RealtimeSubscribe message. */
export function decodeSubscribe(buf: Uint8Array): Record<string, unknown> {
  const T = root.lookupType('chatto.realtime.v1.RealtimeSubscribe')
  return T.toObject(T.decode(buf), { enums: String }) as Record<string, unknown>
}

export class MockWs extends EventEmitter {
  readyState = 1 // OPEN
  binaryType = 'nodebuffer'
  sent: Buffer[] = []
  closedWith: number | undefined
  terminated = false
  send(data: Buffer) { this.sent.push(data) }
  close(code?: number) {
    this.closedWith = code
    this.readyState = 3
  }
  terminate() {
    this.terminated = true
    this.readyState = 3
    this.emit('close', 1006, Buffer.from(''))
  }
}

/** Open the socket, then report caught_up. */
export function handshake(ws: MockWs, cursor = 'cur_0', recovery = 'REALTIME_RECOVERY_LIVE_ONLY') {
  setImmediate(() => {
    ws.emit('open')
    setImmediate(() => ws.emit('message', encodeServerFrame({ caughtUp: { cursor, recovery } })))
  })
}
