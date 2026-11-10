import {
  CreateMessageInputSchema,
  UpdateMessageInputSchema,
} from '../schemas/message'
import type { CreateMessageInput, UpdateMessageInput, FileInput } from '../types'
import { ChattoValidationError } from '../errors'

/** A file queued for upload, optionally with an accessibility description. */
export interface PendingFile {
  file: FileInput
  description?: string
}

export class MessageBuilder {
  private _content?: string
  private _replyTo?: string
  private _threadRoot?: string
  private _alsoSendToChannel?: boolean
  private _createThread?: boolean
  private _linkPreviewToken?: string
  private _idempotencyKey?: string | false
  private _files: PendingFile[] = []
  private _attachmentIds: string[] = []
  private _descriptions = new Map<string, string>()

  setContent(body: string): this {
    this._content = body
    return this
  }

  /**
   * Queue a file to be uploaded and attached when the message is sent. The
   * optional description (max 1,000 characters) is sent as the attachment's
   * accessibility text.
   */
  addFile(file: FileInput, description?: string): this {
    this._files.push({ file, description })
    return this
  }

  /** Queue multiple files to be uploaded and attached when the message is sent. */
  addFiles(...files: FileInput[]): this {
    for (const file of files) this._files.push({ file })
    return this
  }

  /** Attach an already-uploaded asset by id, optionally with a description. */
  addAttachment(assetId: string, description?: string): this {
    this._attachmentIds.push(assetId)
    if (description != null) this._descriptions.set(assetId, description)
    return this
  }

  /** Set the description for an already-uploaded attachment added via `addAttachment`. */
  setAttachmentDescription(assetId: string, description: string): this {
    this._descriptions.set(assetId, description)
    return this
  }

  /** Files queued for upload (consumed by the send flow). */
  getFiles(): FileInput[] {
    return this._files.map(f => f.file)
  }

  /** Files queued for upload together with their descriptions. */
  getPendingFiles(): PendingFile[] {
    return this._files
  }

  /** Explicit, already-uploaded asset ids to attach. */
  getAttachmentIds(): string[] {
    return this._attachmentIds
  }

  /** Descriptions keyed by already-uploaded asset id. */
  getAttachmentDescriptions(): ReadonlyMap<string, string> {
    return this._descriptions
  }

  setReplyTo(eventId: string): this {
    this._replyTo = eventId
    return this
  }

  setThreadRoot(eventId: string): this {
    this._threadRoot = eventId
    return this
  }

  setAlsoSendToChannel(value: boolean): this {
    this._alsoSendToChannel = value
    return this
  }

  /**
   * Establish the new root message as a thread immediately (so it can be
   * followed / replied to before anyone replies). Cannot be combined with a
   * thread root (i.e. with replies).
   */
  setCreateThread(value = true): this {
    this._createThread = value
    return this
  }

  /** Attach a link preview using the token returned by `client.messages.fetchLinkPreview()`. */
  setLinkPreviewToken(token: string): this {
    this._linkPreviewToken = token
    return this
  }

  /**
   * Set the idempotency key (a UUID) for this send. By default the SDK generates
   * a fresh one per send; pass your own and reuse it when retrying after a lost
   * response so the server returns the original message instead of posting a
   * duplicate (valid for 30 minutes). Pass `false` to send without a key.
   */
  setIdempotencyKey(key: string | false): this {
    this._idempotencyKey = key
    return this
  }

  /** The explicit idempotency key, `false` when disabled, or undefined for auto. */
  getIdempotencyKey(): string | false | undefined {
    return this._idempotencyKey
  }

  clone(): MessageBuilder {
    const copy = new MessageBuilder()
    copy._content = this._content
    copy._replyTo = this._replyTo
    copy._threadRoot = this._threadRoot
    copy._alsoSendToChannel = this._alsoSendToChannel
    copy._createThread = this._createThread
    copy._linkPreviewToken = this._linkPreviewToken
    copy._idempotencyKey = this._idempotencyKey
    copy._files = [...this._files]
    copy._attachmentIds = [...this._attachmentIds]
    copy._descriptions = new Map(this._descriptions)
    return copy
  }

  /**
   * Build the `CreateMessage` input from explicit fields. Queued files are not
   * included (they need uploading first) and no idempotency key is generated;
   * use the send flow (`prepareCreateInput`) for that.
   */
  buildCreate(roomId: string): CreateMessageInput {
    const descriptions = this._attachmentIds
      .filter(id => this._descriptions.has(id))
      .map(id => ({ assetId: id, description: this._descriptions.get(id)! }))
    return CreateMessageInputSchema.parse({
      roomId,
      body: this._content,
      inReplyTo: this._replyTo,
      threadRootEventId: this._threadRoot,
      alsoSendToChannel: this._alsoSendToChannel,
      attachmentAssetIds: this._attachmentIds.length > 0 ? this._attachmentIds : undefined,
      createThread: this._createThread,
      linkPreviewToken: this._linkPreviewToken,
      attachmentDescriptions: descriptions.length > 0 ? descriptions : undefined,
      idempotencyKey: typeof this._idempotencyKey === 'string' ? this._idempotencyKey : undefined,
    })
  }

  /**
   * Build the `UpdateMessage` input. Only fields explicitly set on the builder
   * are sent, and `updateMask` names exactly those fields, so an edit of the
   * body leaves the channel-echo state alone and vice versa. Throws when nothing
   * was set.
   */
  buildUpdate(roomId: string, eventId: string): UpdateMessageInput {
    const mask: string[] = []
    if (this._content !== undefined) mask.push('body')
    if (this._alsoSendToChannel !== undefined) mask.push('alsoSendToChannel')
    if (mask.length === 0) {
      throw new ChattoValidationError('empty_update', 'An edit must change the content or alsoSendToChannel')
    }
    return UpdateMessageInputSchema.parse({
      roomId,
      eventId,
      body: this._content,
      alsoSendToChannel: this._alsoSendToChannel,
      updateMask: mask.join(','),
    })
  }
}
