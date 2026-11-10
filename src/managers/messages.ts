import type { ClientContext } from '../context'
import type { Message } from '../resources/message'
import type { MessagePayload, MessageEditPayload } from '../builders/payload'
import { resolveMessagePayload, resolveEditPayload } from '../builders/payload'
import {
  prepareCreateInput,
  createMessageBody,
  normalizeAttachmentDescription,
} from '../builders/create-input'
import { ChattoValidationError } from '../errors'
import { toReactionName } from '../util/emoji'
import { pageRequest, toPage, type Page, type PageOptions } from '../util/page'
import {
  MessageResponseSchema,
  DeleteMessageResponseSchema,
  DeleteAttachmentResponseSchema,
  AddReactionResponseSchema,
  RemoveReactionResponseSchema,
  ListReactionUsersResponseSchema,
  FetchLinkPreviewResponseSchema,
  DeleteLinkPreviewResponseSchema,
  BatchGetMessagesResponseSchema,
  SetAttachmentDescriptionResponseSchema,
  CreatePinnedMessageResponseSchema,
  DeletePinnedMessageResponseSchema,
  type AddReactionResult,
  type RemoveReactionResult,
  type FetchLinkPreviewResult,
} from '../schemas/message'

const SERVICE = 'chatto.api.v1.MessageService'
const MAX_BATCH = 100

/**
 * Message operations (`chatto.api.v1.MessageService`, plus message pins from
 * `RoomService`).
 *
 * Reaction names: Chatto 0.5 stores reactions by shortcode name (`thumbsup`,
 * `heart`, `wave::skin-tone-3`) from its bundled emoji catalogue and rejects
 * Unicode glyphs. The SDK maps a single Unicode emoji (e.g. `'👍'`) to the
 * official client's name, so either form may be passed.
 */
export class MessageManager {
  constructor(private readonly ctx: ClientContext) {}

  /**
   * Send a message. Requires room membership and `message.post` (thread
   * replies: `message.post-in-thread` also suffices). Queued files are uploaded
   * first. An idempotency key is generated per send unless the payload supplies
   * one.
   */
  async send(roomId: string, payload: MessagePayload): Promise<Message> {
    const input = await prepareCreateInput(this.ctx, roomId, resolveMessagePayload(payload))
    const res = await this.ctx.rest.post(SERVICE, 'CreateMessage', createMessageBody(input), MessageResponseSchema)
    return this.ctx.hydrateMessage(res.message)
  }

  /** Fetch one message. NOT_FOUND when missing, retracted, or in another room. */
  async fetch(roomId: string, eventId: string): Promise<Message> {
    const res = await this.ctx.rest.post(SERVICE, 'GetMessage', { roomId, eventId }, MessageResponseSchema)
    return this.ctx.hydrateMessage(res.message)
  }

  /**
   * Fetch up to 100 messages from one room. Missing, retracted and inaccessible
   * ids are silently omitted; order follows the request, de-duplicated.
   */
  async fetchMany(roomId: string, eventIds: string[]): Promise<Message[]> {
    if (eventIds.length === 0) return []
    if (eventIds.length > MAX_BATCH) {
      throw new ChattoValidationError('too_many_event_ids', `At most ${MAX_BATCH} messages may be fetched at once`)
    }
    const res = await this.ctx.rest.post(SERVICE, 'BatchGetMessages', { roomId, eventIds }, BatchGetMessagesResponseSchema)
    return Promise.all(res.messages.map(m => this.ctx.hydrateMessage(m)))
  }

  /**
   * Edit a message's body and/or channel-echo state. Only the given fields
   * change (sent via `updateMask`). Authors may edit within the edit window;
   * `message.manage` permits edits at any time.
   */
  async edit(roomId: string, eventId: string, payload: MessageEditPayload): Promise<Message> {
    const input = resolveEditPayload(payload).buildUpdate(roomId, eventId)
    const res = await this.ctx.rest.post(SERVICE, 'UpdateMessage', input, MessageResponseSchema)
    return this.ctx.hydrateMessage(res.message)
  }

  /** Retract a message. Authors may delete their own; others need `message.manage`. */
  async delete(roomId: string, eventId: string): Promise<void> {
    await this.ctx.rest.post(SERVICE, 'DeleteMessage', { roomId, eventId }, DeleteMessageResponseSchema)
  }

  /**
   * Add the current user's reaction. `emoji` is a shortcode name (`'thumbsup'`)
   * or a single Unicode emoji, which is mapped to its name. Echo ids resolve to
   * the original message. A user may have at most 20 distinct reactions per
   * message; re-adding an existing one is a no-op (`added: false`).
   */
  async react(roomId: string, eventId: string, emoji: string): Promise<AddReactionResult> {
    return this.ctx.rest.post(
      SERVICE,
      'AddReaction',
      { roomId, messageEventId: eventId, emoji: toReactionName(emoji) },
      AddReactionResponseSchema,
    )
  }

  /**
   * Remove the current user's reaction (shortcode name or Unicode emoji).
   * `reaction` is absent in the result when no reactions for that emoji remain.
   */
  async removeReaction(roomId: string, eventId: string, emoji: string): Promise<RemoveReactionResult> {
    return this.ctx.rest.post(
      SERVICE,
      'RemoveReaction',
      { roomId, messageEventId: eventId, emoji: toReactionName(emoji) },
      RemoveReactionResponseSchema,
    )
  }

  /**
   * List the user ids that reacted with `emoji`, ordered by user id. Page size
   * defaults to 50 (max 100). Use `client.users` to resolve profiles.
   */
  async fetchReactionUsers(
    roomId: string,
    eventId: string,
    emoji: string,
    page?: PageOptions,
  ): Promise<Page<string>> {
    const res = await this.ctx.rest.post(
      SERVICE,
      'ListReactionUsers',
      { roomId, messageEventId: eventId, emoji: toReactionName(emoji), page: pageRequest(page) },
      ListReactionUsersResponseSchema,
    )
    return toPage(res.userIds, res.page)
  }

  /**
   * Fetch server-side link preview metadata for a URL (max 2,048 chars).
   * `preview` is absent when the URL cannot be previewed. Pass the returned
   * `previewToken` as `linkPreviewToken` when sending to attach the preview;
   * set `omitPreviewToken` for display-only reads.
   */
  async fetchLinkPreview(url: string, opts: { omitPreviewToken?: boolean } = {}): Promise<FetchLinkPreviewResult> {
    if (url.length === 0 || url.length > 2048) {
      throw new ChattoValidationError('invalid_url', 'The URL must be 1–2048 characters')
    }
    return this.ctx.rest.post(
      SERVICE,
      'FetchLinkPreview',
      { url, omitPreviewToken: opts.omitPreviewToken || undefined },
      FetchLinkPreviewResponseSchema,
    )
  }

  /** Remove the link preview for `url` from the author's own message. */
  async deleteLinkPreview(roomId: string, eventId: string, url: string): Promise<void> {
    await this.ctx.rest.post(SERVICE, 'DeleteLinkPreview', { roomId, eventId, url }, DeleteLinkPreviewResponseSchema)
  }

  /** Remove one attachment from the author's own message. */
  async deleteAttachment(roomId: string, eventId: string, attachmentId: string): Promise<void> {
    await this.ctx.rest.post(
      SERVICE,
      'DeleteAttachment',
      { roomId, eventId, attachmentId },
      DeleteAttachmentResponseSchema,
    )
  }

  /**
   * Set (or, with an empty string, clear) an attachment's description. Trimmed;
   * max 1,000 characters. Authors may change it within the edit window;
   * `message.manage` permits it at any time. Returns the updated message.
   */
  async setAttachmentDescription(
    roomId: string,
    eventId: string,
    attachmentId: string,
    description: string,
  ): Promise<Message> {
    const res = await this.ctx.rest.post(
      SERVICE,
      'SetAttachmentDescription',
      { roomId, eventId, attachmentId, description: normalizeAttachmentDescription(description) },
      SetAttachmentDescriptionResponseSchema,
    )
    return this.ctx.hydrateMessage(res.message)
  }

  /**
   * Pin a message in a channel room (`RoomService.CreatePinnedMessage`).
   * Requires `message.pin`; idempotent; DM rooms are rejected. Pass the
   * canonical message id (not a channel echo). Returns the pinned message.
   */
  async pin(roomId: string, eventId: string): Promise<Message | undefined> {
    const res = await this.ctx.rest.post(
      'chatto.api.v1.RoomService',
      'CreatePinnedMessage',
      { roomId, messageEventId: eventId },
      CreatePinnedMessageResponseSchema,
    )
    const message = res.pinnedMessage?.message
    return message == null ? undefined : this.ctx.hydrateMessage(message)
  }

  /**
   * Unpin a message (`RoomService.DeletePinnedMessage`). Requires `message.pin`;
   * idempotent. Resolves `true` when the message is not pinned afterwards.
   */
  async unpin(roomId: string, eventId: string): Promise<boolean> {
    const res = await this.ctx.rest.post(
      'chatto.api.v1.RoomService',
      'DeletePinnedMessage',
      { roomId, messageEventId: eventId },
      DeletePinnedMessageResponseSchema,
    )
    return res.deleted
  }
}
