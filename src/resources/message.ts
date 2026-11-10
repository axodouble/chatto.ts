import type { MessageData, MessageReaction } from '../types'
import type { ClientContext } from '../context'
import type { User } from './user'
import type { Room } from './room'
import type { MessagePayload, MessageEditPayload } from '../builders/payload'
import type {
  LinkPreview,
  ThreadSummary,
  MessageViewerState,
  AddReactionResult,
  RemoveReactionResult,
} from '../schemas/message'
import type { ThreadFollowState, MarkThreadAsReadResult } from '../schemas/thread'
import type { ThreadEventsPage } from '../managers/threads'
import type { Page, PageOptions } from '../util/page'
import { Attachment } from './attachment'
import { resolveMessagePayload } from '../builders/payload'
import { MessageManager } from '../managers/messages'
import { ThreadManager } from '../managers/threads'

export class Message {
  readonly id: string
  readonly channelId: string
  /** Body text. Absent when the message has none (e.g. attachments only, or deleted). */
  readonly content: string | undefined
  readonly actorId: string
  readonly author: User
  readonly channel: Room
  readonly createdAt: string
  readonly editedAt: string | undefined
  /** Event this message directly replies to. */
  readonly inReplyTo: string | undefined
  /** Root of the thread this message is a reply in. */
  readonly threadRootEventId: string | undefined
  readonly attachments: Attachment[]
  /** Reaction summaries. Names are Chatto shortcodes (e.g. `thumbsup`), not Unicode. */
  readonly reactions: MessageReaction[]
  readonly linkPreview: LinkPreview | undefined
  /** Thread summary; present once a thread exists for this root message. */
  readonly thread: ThreadSummary | undefined
  /** True when the (canonical) message is currently pinned. */
  readonly pinned: boolean
  /** Set when the content was retracted or crypto-shredded. */
  readonly deletedAt: string | undefined
  /** Viewer capabilities (e.g. whether you can reply in its thread). */
  readonly viewerState: MessageViewerState | undefined
  /** For a channel echo of a thread reply: the original reply's id. */
  readonly echoOfEventId: string | undefined
  /** For a channel echo: the thread root of the echoed reply. */
  readonly echoFromThreadRootEventId: string | undefined
  /** For a thread reply echoed to the channel: the echo's event id. */
  readonly channelEchoEventId: string | undefined
  /** The raw parsed message data. */
  readonly data: MessageData

  constructor(
    data: MessageData,
    private readonly ctx: ClientContext,
    resolved: { author: User; channel: Room },
  ) {
    this.data = data
    this.id = data.id
    this.channelId = data.roomId
    this.content = data.body
    this.actorId = data.actorId
    this.author = resolved.author
    this.channel = resolved.channel
    this.createdAt = data.createdAt
    this.editedAt = data.updatedAt
    this.inReplyTo = data.inReplyTo
    this.threadRootEventId = data.threadRootEventId
    this.attachments = (data.attachments ?? []).map(a => new Attachment(a))
    this.reactions = data.reactions ?? []
    this.linkPreview = data.linkPreview
    this.thread = data.thread
    this.pinned = data.pinned ?? false
    this.deletedAt = data.deletedAt
    this.viewerState = data.viewerState
    this.echoOfEventId = data.echoOfEventId
    this.echoFromThreadRootEventId = data.echoFromThreadRootEventId
    this.channelEchoEventId = data.channelEchoEventId
  }

  /** The original message id (resolves a channel echo to the thread reply it echoes). */
  get canonicalId(): string {
    return this.echoOfEventId ?? this.id
  }

  /**
   * Root id of the thread this message belongs to: its thread root for a
   * reply (or echo of one), otherwise itself (it is, or can become, a root).
   */
  get threadRootId(): string {
    return this.threadRootEventId ?? this.echoFromThreadRootEventId ?? this.id
  }

  /** True when this is a reply inside a thread (not counting channel echoes). */
  get isThreadReply(): boolean {
    return this.threadRootEventId != null
  }

  /** True when this is the channel echo of a thread reply. */
  get isEcho(): boolean {
    return this.echoOfEventId != null
  }

  private get messages(): MessageManager {
    return new MessageManager(this.ctx)
  }

  private get threads(): ThreadManager {
    return new ThreadManager(this.ctx)
  }

  /** Re-fetch this message. */
  fetch(): Promise<Message> {
    return this.messages.fetch(this.channelId, this.id)
  }

  /** Edit the body and/or echo state. Only the given fields change. */
  edit(payload: MessageEditPayload): Promise<Message> {
    return this.messages.edit(this.channelId, this.id, payload)
  }

  delete(): Promise<void> {
    return this.messages.delete(this.channelId, this.id)
  }

  /** React with a shortcode name (`'thumbsup'`) or a single Unicode emoji (`'👍'`). */
  react(emoji: string): Promise<AddReactionResult> {
    return this.messages.react(this.channelId, this.id, emoji)
  }

  /** Remove your reaction (shortcode name or Unicode emoji). */
  removeReaction(emoji: string): Promise<RemoveReactionResult> {
    return this.messages.removeReaction(this.channelId, this.id, emoji)
  }

  /** User ids that reacted with `emoji` (page size defaults to 50, max 100). */
  fetchReactionUsers(emoji: string, page?: PageOptions): Promise<Page<string>> {
    return this.messages.fetchReactionUsers(this.channelId, this.id, emoji, page)
  }

  /**
   * Reply in this message's thread (starting one if needed). Replying to a
   * channel echo replies to the original thread reply.
   */
  async reply(payload: MessagePayload): Promise<Message> {
    const builder = resolveMessagePayload(payload).clone()
    builder.setReplyTo(this.canonicalId)
    builder.setThreadRoot(this.threadRootId)
    return this.messages.send(this.channelId, builder)
  }

  deleteAttachment(attachmentId: string): Promise<void> {
    return this.messages.deleteAttachment(this.channelId, this.id, attachmentId)
  }

  /** Set (or clear with `''`) an attachment's description. Max 1,000 characters. */
  setAttachmentDescription(attachmentId: string, description: string): Promise<Message> {
    return this.messages.setAttachmentDescription(this.channelId, this.id, attachmentId, description)
  }

  /**
   * Remove the link preview from your own message. Defaults to the current
   * preview's URL; resolves without a request when there is none.
   */
  async removeLinkPreview(url: string | undefined = this.linkPreview?.url): Promise<void> {
    if (url == null) return
    await this.messages.deleteLinkPreview(this.channelId, this.id, url)
  }

  /** Pin this message (channel rooms; requires `message.pin`). */
  pin(): Promise<Message | undefined> {
    return this.messages.pin(this.channelId, this.canonicalId)
  }

  /** Unpin this message. Resolves `true` when it is not pinned afterwards. */
  unpin(): Promise<boolean> {
    return this.messages.unpin(this.channelId, this.canonicalId)
  }

  /** Fetch a page of this message's thread (latest replies plus the root by default). */
  fetchThread(opts: { limit?: number; before?: string; after?: string } = {}): Promise<ThreadEventsPage> {
    return this.threads.fetchEvents(this.channelId, this.threadRootId, opts)
  }

  /** Fetch every message in this message's thread. */
  fetchThreadHistory(): Promise<Message[]> {
    return this.threads.fetchHistory(this.channelId, this.threadRootId)
  }

  /** Distinct authors in this message's thread (user ids). */
  fetchThreadParticipants(page?: PageOptions): Promise<Page<string>> {
    return this.threads.fetchParticipants(this.channelId, this.threadRootId, page)
  }

  /** Follow this message's thread. */
  follow(): Promise<ThreadFollowState> {
    return this.threads.follow(this.channelId, this.threadRootId)
  }

  /** Stop following this message's thread. */
  unfollow(): Promise<ThreadFollowState> {
    return this.threads.unfollow(this.channelId, this.threadRootId)
  }

  /**
   * Mark this message's thread read. For a thread reply, marks through this
   * reply; for a root, marks through the latest reply.
   */
  markThreadRead(upToEventId: string | undefined = this.isThreadReply ? this.id : undefined): Promise<MarkThreadAsReadResult> {
    return this.threads.markAsRead(this.channelId, this.threadRootId, upToEventId)
  }
}
