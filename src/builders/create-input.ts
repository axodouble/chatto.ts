import type { ClientContext } from '../context'
import type { MessageBuilder } from './message'
import type { CreateMessageInput } from '../types'
import { ChattoValidationError } from '../errors'

const MAX_ATTACHMENTS = 10
const MAX_DESCRIPTION_CHARS = 1000
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Trim an attachment description and enforce Chatto's 1,000-character limit.
 * An empty result means "no description" (CreateMessage) or "clear" (SetAttachmentDescription).
 */
export function normalizeAttachmentDescription(description: string): string {
  const trimmed = description.trim()
  if ([...trimmed].length > MAX_DESCRIPTION_CHARS) {
    throw new ChattoValidationError(
      'attachment_description_too_long',
      `Attachment descriptions may be at most ${MAX_DESCRIPTION_CHARS} characters`,
    )
  }
  return trimmed
}

/**
 * Resolve a builder into a `CreateMessage` input: upload any queued files, merge
 * their asset ids after the explicitly-provided ids, attach descriptions, pick an
 * idempotency key, and validate the result. A message must carry body text or at
 * least one attachment, and no more than ten attachments total.
 *
 * Unless the builder carries an explicit key (or `false`), a fresh UUID
 * idempotency key is generated for every call, so a builder reused as a
 * template never collides with an earlier send.
 */
export async function prepareCreateInput(
  ctx: ClientContext,
  roomId: string,
  builder: MessageBuilder,
): Promise<CreateMessageInput> {
  const files = builder.getPendingFiles()
  const attachmentAssetIds = [...builder.getAttachmentIds()]

  // Validate everything we can before uploading anything, so an invalid
  // message does not leave orphaned assets on the server.
  if (attachmentAssetIds.length + files.length > MAX_ATTACHMENTS) {
    throw new ChattoValidationError(
      'too_many_attachments',
      `A message may have at most ${MAX_ATTACHMENTS} attachments`,
    )
  }

  const input = builder.buildCreate(roomId)
  const hasBody = input.body != null && input.body.length > 0
  if (!hasBody && attachmentAssetIds.length + files.length === 0) {
    throw new ChattoValidationError(
      'empty_message',
      'A message must have body text or at least one attachment',
    )
  }
  if (input.createThread && input.threadRootEventId != null) {
    throw new ChattoValidationError(
      'create_thread_in_thread',
      'createThread cannot be combined with a thread root (thread replies)',
    )
  }

  const explicitKey = builder.getIdempotencyKey()
  if (typeof explicitKey === 'string' && !UUID_PATTERN.test(explicitKey)) {
    throw new ChattoValidationError('invalid_idempotency_key', 'The idempotency key must be a UUID')
  }

  const descriptions = new Map<string, string>()
  for (const [assetId, text] of builder.getAttachmentDescriptions()) {
    if (!attachmentAssetIds.includes(assetId)) {
      throw new ChattoValidationError(
        'unknown_attachment_description',
        `Attachment description targets asset ${assetId}, which is not attached to the message`,
      )
    }
    descriptions.set(assetId, normalizeAttachmentDescription(text))
  }
  const fileDescriptions = files.map(f =>
    f.description == null ? undefined : normalizeAttachmentDescription(f.description),
  )

  for (const [i, { file }] of files.entries()) {
    const asset = await ctx.assets.upload(roomId, file)
    attachmentAssetIds.push(asset.id)
    const description = fileDescriptions[i]
    if (description != null) descriptions.set(asset.id, description)
  }

  const attachmentDescriptions = [...descriptions]
    .filter(([, description]) => description.length > 0)
    .map(([assetId, description]) => ({ assetId, description }))

  return {
    ...input,
    attachmentAssetIds: attachmentAssetIds.length > 0 ? attachmentAssetIds : undefined,
    attachmentDescriptions: attachmentDescriptions.length > 0 ? attachmentDescriptions : undefined,
    idempotencyKey:
      explicitKey === false ? undefined : (explicitKey ?? crypto.randomUUID()),
  }
}

/**
 * Turn a prepared `CreateMessageInput` into the `CreateMessage` request body.
 * Shared by every send path (`client.messages.send`, `Room#send`,
 * `Message#reply`) so new fields only need adding here.
 */
export function createMessageBody(input: CreateMessageInput): Record<string, unknown> {
  return {
    roomId: input.roomId,
    body: input.body,
    attachmentAssetIds: input.attachmentAssetIds,
    attachmentDescriptions: input.attachmentDescriptions,
    inReplyTo: input.inReplyTo,
    threadRootEventId: input.threadRootEventId,
    alsoSendToChannel: input.alsoSendToChannel,
    createThread: input.createThread,
    linkPreviewToken: input.linkPreviewToken,
    idempotencyKey: input.idempotencyKey,
  }
}
