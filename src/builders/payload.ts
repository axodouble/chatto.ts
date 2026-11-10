import { MessageBuilder } from './message'
import type { FileInput } from '../types'

/** A file to upload, optionally with an accessibility description. */
export type MessageFileInput = FileInput & { description?: string }

export interface MessageOptions {
  content?: string
  /** Files to upload and attach (max 10 attachments total). */
  files?: MessageFileInput[]
  /** Already-uploaded asset ids to attach. */
  attachmentIds?: string[]
  /** Descriptions for `attachmentIds`, keyed by asset id (max 1,000 characters each). */
  attachmentDescriptions?: Record<string, string>
  /** For thread replies: also echo the reply into the main channel timeline. */
  alsoSendToChannel?: boolean
  /** Establish this root message as a thread immediately. */
  createThread?: boolean
  /** Token from `client.messages.fetchLinkPreview()` to attach that preview. */
  linkPreviewToken?: string
  /**
   * Idempotency key (UUID) for this send. Auto-generated when omitted; reuse
   * your own key when retrying after a lost response. `false` disables it.
   */
  idempotencyKey?: string | false
}

export type MessagePayload = string | MessageOptions | MessageBuilder

export function resolveMessagePayload(payload: MessagePayload): MessageBuilder {
  if (payload instanceof MessageBuilder) return payload
  if (typeof payload === 'string') return new MessageBuilder().setContent(payload)
  const builder = new MessageBuilder()
  if (payload.content != null) builder.setContent(payload.content)
  if (payload.files != null) {
    for (const { description, ...file } of payload.files) builder.addFile(file, description)
  }
  if (payload.attachmentIds != null) {
    for (const id of payload.attachmentIds) builder.addAttachment(id)
  }
  if (payload.attachmentDescriptions != null) {
    for (const [id, text] of Object.entries(payload.attachmentDescriptions)) {
      builder.setAttachmentDescription(id, text)
    }
  }
  if (payload.alsoSendToChannel != null) builder.setAlsoSendToChannel(payload.alsoSendToChannel)
  if (payload.createThread != null) builder.setCreateThread(payload.createThread)
  if (payload.linkPreviewToken != null) builder.setLinkPreviewToken(payload.linkPreviewToken)
  if (payload.idempotencyKey != null) builder.setIdempotencyKey(payload.idempotencyKey)
  return builder
}

/** What an edit may change. Only the fields given are sent (see `UpdateMessage` update_mask). */
export type MessageEditPayload =
  | string
  | { content?: string; alsoSendToChannel?: boolean }
  | MessageBuilder

export function resolveEditPayload(payload: MessageEditPayload): MessageBuilder {
  if (payload instanceof MessageBuilder) return payload
  if (typeof payload === 'string') return new MessageBuilder().setContent(payload)
  const builder = new MessageBuilder()
  if (payload.content !== undefined) builder.setContent(payload.content)
  if (payload.alsoSendToChannel !== undefined) builder.setAlsoSendToChannel(payload.alsoSendToChannel)
  return builder
}
