import type { RoomData } from '../types'
import type { ClientContext } from '../context'
import type { Message } from './message'
import type { MessagePayload } from '../builders/payload'
import { resolveMessagePayload } from '../builders/payload'
import { prepareCreateInput } from '../builders/create-input'
import { MessageResponseSchema } from '../schemas/message'
import { GetRoomEventsResponseSchema, RoomSchema } from '../schemas/room'

export class Room {
  readonly id: string
  readonly name: string
  readonly description: string | undefined
  readonly kind: string
  readonly archived: boolean

  constructor(data: RoomData, private readonly ctx: ClientContext) {
    this.id = data.id
    this.name = data.name
    this.description = data.description
    this.kind = data.kind
    this.archived = data.archived
  }

  static partial(id: string, ctx: ClientContext): Room {
    return new Room(RoomSchema.parse({ id, name: id }), ctx)
  }

  async send(payload: MessagePayload): Promise<Message> {
    const input = await prepareCreateInput(this.ctx, this.id, resolveMessagePayload(payload))
    const res = await this.ctx.rest.post(
      'chatto.api.v1.MessageService',
      'CreateMessage',
      {
        roomId: input.roomId,
        body: input.body,
        attachmentAssetIds: input.attachmentAssetIds,
        inReplyTo: input.inReplyTo,
        threadRootEventId: input.threadRootEventId,
        alsoSendToChannel: input.alsoSendToChannel,
      },
      MessageResponseSchema,
    )
    return this.ctx.hydrateMessage(res.message)
  }

  async fetchHistory(opts: { limit?: number; before?: string; after?: string } = {}): Promise<Message[]> {
    const res = await this.ctx.rest.post(
      'chatto.api.v1.RoomService',
      'GetRoomEvents',
      {
        roomId: this.id,
        limit: opts.limit,
        // `before`/`after` form a oneof, which proto3 JSON encodes flat.
        before: opts.before,
        after: opts.before == null ? opts.after : undefined,
      },
      GetRoomEventsResponseSchema,
    )
    return Promise.all(
      res.page.events
        .filter(e => e.messagePosted != null)
        .map(e => this.ctx.hydrateMessage(e.messagePosted!.message)),
    )
  }
}
