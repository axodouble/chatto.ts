import protobuf from 'protobufjs'
import descriptor from './descriptor.json'
import type { RealtimeInitialState, RealtimeServerFrame } from './generated'

/** The only realtime protocol version accepted by Chatto 0.5. */
export const REALTIME_PROTOCOL_VERSION = 4

let _root: protobuf.Root | null = null

function getRoot(): protobuf.Root {
  if (_root == null) _root = protobuf.Root.fromJSON(descriptor as protobuf.INamespace)
  return _root
}

export interface SubscribeFrame {
  bearerToken?: string
  resumeCursor?: string
  initialState: RealtimeInitialState
}

/** Encode the single `RealtimeSubscribe` message a client sends after the socket opens. */
export function encodeSubscribe(frame: SubscribeFrame): Buffer {
  const Subscribe = getRoot().lookupType('chatto.realtime.v1.RealtimeSubscribe')
  const message = Subscribe.fromObject({
    protocolVersion: REALTIME_PROTOCOL_VERSION,
    bearerToken: frame.bearerToken,
    resumeCursor: frame.resumeCursor,
    initialState: frame.initialState,
  })
  return Buffer.from(Subscribe.encode(message).finish())
}

/**
 * Decode one server frame into the generated plain-object shape:
 * camelCase fields, enums as their proto names, int64 as numbers,
 * `google.protobuf.Timestamp` as ISO-8601 strings and `Duration` as
 * milliseconds. Scalars, enums, and repeated fields carry their defaults;
 * unset message fields, oneof members, and proto3 `optional` fields are absent.
 */
export function decodeServerFrame(buffer: Uint8Array): RealtimeServerFrame {
  const ServerFrame = getRoot().lookupType('chatto.realtime.v1.RealtimeServerFrame')
  const decoded = ServerFrame.decode(buffer)
  const obj = ServerFrame.toObject(decoded, {
    longs: Number,
    enums: String,
    defaults: true,
    arrays: true,
    oneofs: true,
  })
  return normalize(ServerFrame, obj) as unknown as RealtimeServerFrame
}

function normalize(type: protobuf.Type, obj: Record<string, unknown>): Record<string, unknown> {
  for (const key of Object.keys(obj)) {
    const value = obj[key]
    // Synthetic oneofs of proto3 `optional` fields add `_name` virtual keys.
    if (key.startsWith('_') || value == null) {
      delete obj[key]
      continue
    }
    const field = type.fields[key]
    if (field == null) continue // oneof virtual field (e.g. `event: 'messagePosted'`)
    const resolved = field.resolvedType
    if (!(resolved instanceof protobuf.Type)) continue
    const convert = (v: unknown) => convertMessage(resolved, v as Record<string, unknown>)
    obj[key] = Array.isArray(value) ? value.map(convert) : convert(value)
  }
  return obj
}

function convertMessage(type: protobuf.Type, value: Record<string, unknown>): unknown {
  switch (type.fullName) {
    case '.google.protobuf.Timestamp': {
      const ms = Number(value['seconds'] ?? 0) * 1000 + Math.floor(Number(value['nanos'] ?? 0) / 1_000_000)
      return new Date(ms).toISOString()
    }
    case '.google.protobuf.Duration':
      return Number(value['seconds'] ?? 0) * 1000 + Math.floor(Number(value['nanos'] ?? 0) / 1_000_000)
    default:
      return normalize(type, value)
  }
}
