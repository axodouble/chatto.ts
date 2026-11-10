import { EventEmitter } from 'events'
import { mock, spyOn } from 'bun:test'
import { ChattoClient } from '../../src/client'
import type { RealtimeConnection } from '../../src/realtime/connection'

/**
 * A small in-memory Chatto server for offline tests. It answers the ConnectRPC
 * calls the SDK makes over `fetch` (Chatto 0.5 shapes), checks the bearer token
 * on every call, and pushes realtime events to every client it created.
 */

interface StoredMessage {
  id: string
  roomId: string
  createdAt: string
  actorId: string
  body?: string
  updatedAt?: string
  inReplyTo?: string
  threadRootEventId?: string
  attachments: Array<{ id: string; filename: string; contentType: string; width?: number; height?: number }>
}

interface FakeUser {
  id: string
  login: string
  displayName: string
  bot?: { ownerUserId?: string }
}

type MockRt = EventEmitter & { connect: ReturnType<typeof mock>; disconnect: ReturnType<typeof mock> }

export class FakeChatto {
  /** Small on purpose so even a well-compressed test image spans several chunks. */
  static readonly MAX_CHUNK_SIZE = 1024

  readonly baseUrl = 'https://fake.chatto.test'
  readonly room = { id: 'R_general', name: 'general', kind: 'ROOM_KIND_CHANNEL', archived: false, universal: false }
  readonly users = new Map<string, FakeUser>()
  /** Bot API key → user id. */
  readonly tokens = new Map<string, string>()
  readonly messages = new Map<string, StoredMessage>()
  readonly reactions: Array<{ messageEventId: string; emoji: string; actorId: string }> = []
  /** Reaction names the server accepts; anything else is INVALID_ARGUMENT. */
  readonly knownReactions = new Set(['thumbsup', 'tada', 'rocket', 'heart', 'wave'])
  private readonly idempotency = new Map<string, StoredMessage>()
  readonly calls: Array<{ method: string; body: Record<string, unknown>; userId: string }> = []
  /** Make the next call to this RPC method fail with a 500. */
  failNext = new Set<string>()

  private seq = 0
  private readonly uploads = new Map<string, { filename: string; contentType: string; size: number; received: number; roomId: string; sha256: string }>()
  private readonly realtimes: MockRt[] = []
  private fetchSpy: ReturnType<typeof spyOn> | null = null

  addUser(user: FakeUser, token?: string): FakeUser {
    this.users.set(user.id, user)
    if (token != null) this.tokens.set(token, user.id)
    return user
  }

  install(): this {
    this.fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (input: string | URL | Request, init?: RequestInit) =>
      this.handle(String(input), init ?? {})) as typeof fetch)
    return this
  }

  uninstall(): void {
    this.fetchSpy?.mockRestore()
    this.fetchSpy = null
  }

  /** A real ChattoClient wired to this server with a fake realtime socket. */
  client(token: string): ChattoClient {
    return new ChattoClient({ baseUrl: this.baseUrl, token }, () => {
      const rt = Object.assign(new EventEmitter(), {
        connect: mock(() => Promise.resolve()),
        disconnect: mock(() => {}),
      }) as MockRt
      this.realtimes.push(rt)
      return rt as unknown as RealtimeConnection
    })
  }

  /** Posts a message as `userId` the way a human client would, broadcasting it over realtime. */
  post(userId: string, body: string, extra: Partial<StoredMessage> = {}): StoredMessage {
    const msg = this.store({ roomId: this.room.id, actorId: userId, body, ...extra })
    return msg
  }

  /** Messages that reply to `messageId`, in send order. */
  repliesTo(messageId: string): StoredMessage[] {
    return [...this.messages.values()].filter(m => m.inReplyTo === messageId)
  }

  /** Resolves once `predicate` holds, polling briefly; rejects after `timeoutMs`. */
  async waitFor<T>(predicate: () => T | undefined | null | false, timeoutMs = 2000): Promise<T> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const value = predicate()
      if (value) return value
      if (Date.now() > deadline) throw new Error('FakeChatto.waitFor timed out')
      await new Promise(r => setTimeout(r, 5))
    }
  }

  /** Simulates the server closing realtime because the key was revoked. */
  revoke(token: string): void {
    this.tokens.delete(token)
    for (const rt of this.realtimes) rt.emit('close', { kind: 'auth', code: 1000, realtimeCode: 'REALTIME_CLOSE_CODE_UNAUTHENTICATED', retryAfterMs: 0 })
  }

  private store(partial: Omit<StoredMessage, 'id' | 'createdAt' | 'attachments'> & { attachments?: StoredMessage['attachments'] }): StoredMessage {
    const msg: StoredMessage = { id: `evt_${++this.seq}`, createdAt: new Date().toISOString(), attachments: [], ...partial }
    this.messages.set(msg.id, msg)
    // Chatto 0.5: for messagePosted the event id is the message's event id.
    this.broadcast({ id: msg.id, actorId: msg.actorId, createdAt: msg.createdAt, messagePosted: { roomId: msg.roomId } })
    return msg
  }

  private broadcast(event: unknown): void {
    for (const rt of this.realtimes) rt.emit('event', event)
  }

  private uploadView(id: string, assetId?: string) {
    const up = this.uploads.get(id)!
    return {
      uploadId: id, roomId: up.roomId, sha256: up.sha256, maxChunkSize: FakeChatto.MAX_CHUNK_SIZE,
      size: String(up.size), committedOffset: String(up.received),
      status: assetId ? 'ASSET_UPLOAD_STATUS_COMPLETED' : 'ASSET_UPLOAD_STATUS_OPEN', assetId,
    }
  }

  private json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  }

  private async handle(url: string, init: RequestInit): Promise<Response> {
    const prefix = `${this.baseUrl}/api/connect/`
    if (!url.startsWith(prefix)) return this.json(404, { code: 'not_found', message: url })
    const [service, method] = url.slice(prefix.length).split('/') as [string, string]

    const auth = new Headers(init.headers).get('Authorization') ?? ''
    const userId = this.tokens.get(auth.replace(/^Bearer /, ''))
    if (userId == null) return this.json(401, { code: 'unauthenticated', message: 'invalid token' })

    const body = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>
    this.calls.push({ method, body, userId })
    if (this.failNext.delete(method)) return this.json(500, { code: 'internal', message: `${method} failed` })

    const ok = (b: unknown) => this.json(200, b)
    const member = (u: FakeUser) => ({ user: { ...u, deleted: false, presenceStatus: 'PRESENCE_STATUS_ONLINE' }, roles: [] })

    switch (`${service}/${method}`) {
      case 'chatto.api.v1.ViewerService/GetViewer':
        return ok({ user: { profile: this.users.get(userId) } })
      case 'chatto.api.v1.UserService/GetUser': {
        const u = this.users.get(String(body['userId']))
        return u ? ok({ user: member(u) }) : this.json(404, { code: 'not_found', message: 'no user' })
      }
      case 'chatto.api.v1.RoomDirectoryService/GetRoom':
        return ok({ room: { room: this.room } })
      case 'chatto.api.v1.MessageService/GetMessage': {
        const m = this.messages.get(String(body['eventId']))
        return m ? ok({ message: m }) : this.json(404, { code: 'not_found', message: 'no message' })
      }
      case 'chatto.api.v1.MessageService/CreateMessage': {
        const key = body['idempotencyKey'] as string | undefined
        if (key != null && this.idempotency.has(key)) return ok({ message: this.idempotency.get(key) })
        const ids = (body['attachmentAssetIds'] as string[] | undefined) ?? []
        const attachments = ids.map(id => {
          const up = this.uploads.get(id)!
          return { id, filename: up.filename, contentType: up.contentType, width: 256, height: 256 }
        })
        const msg = this.store({
          roomId: String(body['roomId']),
          actorId: userId,
          body: body['body'] as string | undefined,
          inReplyTo: body['inReplyTo'] as string | undefined,
          threadRootEventId: body['threadRootEventId'] as string | undefined,
          attachments,
        })
        if (key != null) this.idempotency.set(key, msg)
        return ok({ message: msg })
      }
      case 'chatto.api.v1.MessageService/UpdateMessage': {
        const m = this.messages.get(String(body['eventId']))!
        m.body = body['body'] as string | undefined
        m.updatedAt = new Date().toISOString()
        return ok({ message: m })
      }
      case 'chatto.api.v1.MessageService/AddReaction':
        if (!this.knownReactions.has(String(body['emoji']))) return this.json(400, { code: 'invalid_argument', message: 'unknown reaction' })
        this.reactions.push({ messageEventId: String(body['messageEventId']), emoji: String(body['emoji']), actorId: userId })
        return ok({ added: true })
      case 'chatto.api.v1.ThreadService/GetThreadEvents': {
        const root = String(body['threadRootEventId'])
        const events = [...this.messages.values()]
          .filter(m => m.threadRootEventId === root)
          .map(m => ({ id: `e_${m.id}`, createdAt: m.createdAt, actorId: m.actorId, messagePosted: { message: m } }))
        return ok({ page: { events } })
      }
      case 'chatto.api.v1.AssetUploadService/CreateUpload': {
        const id = `asset_${++this.seq}`
        this.uploads.set(id, {
          filename: String(body['filename']), contentType: String(body['contentType']), size: Number(body['size']),
          received: 0, roomId: String(body['roomId']), sha256: String(body['sha256']),
        })
        return ok({ upload: this.uploadView(id) })
      }
      case 'chatto.api.v1.AssetUploadService/UploadChunk': {
        const up = this.uploads.get(String(body['uploadId']))!
        up.received += Buffer.from(String(body['content']), 'base64').length
        return ok({ upload: this.uploadView(String(body['uploadId'])) })
      }
      case 'chatto.api.v1.AssetUploadService/CompleteUpload': {
        const id = String(body['uploadId'])
        const up = this.uploads.get(id)!
        if (up.received !== up.size) return this.json(400, { code: 'invalid_argument', message: 'size mismatch' })
        return ok({ upload: this.uploadView(id, id), asset: { id, filename: up.filename, contentType: up.contentType, size: String(up.size), width: 256, height: 256 } })
      }
      case 'chatto.api.v1.MyAccountService/UpdatePresence':
        return ok({ status: body['status'] })
      default:
        return this.json(501, { code: 'unimplemented', message: `${service}/${method}` })
    }
  }
}
