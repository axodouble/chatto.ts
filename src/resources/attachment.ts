import type { AssetData, MessageAttachmentData, VideoProcessingData } from '../types'

/**
 * A media attachment. Wraps both upload results (`Asset`, which carries `size`)
 * and message attachments (`MessageAttachment`, which does not).
 *
 * Signed URLs (`url`, `thumbnailUrl`) are time-limited and may be absent while a
 * video is still processing. Refresh them with `client.assets.fetch()`.
 */
export class Attachment {
  readonly id: string
  readonly filename: string
  readonly contentType: string
  readonly size: number | undefined
  readonly width: number | undefined
  readonly height: number | undefined
  readonly url: string | undefined
  readonly urlExpiresAt: string | undefined
  readonly thumbnailUrl: string | undefined
  readonly videoProcessing: VideoProcessingData | undefined
  /** Accessibility description, when set (see `message.setAttachmentDescription`). */
  readonly description: string | undefined

  constructor(data: AssetData | MessageAttachmentData) {
    this.id = data.id
    this.filename = data.filename
    this.contentType = data.contentType
    this.size = 'size' in data ? data.size : undefined
    this.width = data.width
    this.height = data.height
    this.url = data.assetUrl?.url
    this.urlExpiresAt = data.assetUrl?.expiresAt
    this.thumbnailUrl = data.thumbnailAssetUrl?.url
    this.videoProcessing = data.videoProcessing
    this.description = 'description' in data ? data.description : undefined
  }

  get isImage(): boolean {
    return this.contentType.startsWith('image/')
  }

  get isVideo(): boolean {
    return this.contentType.startsWith('video/')
  }
}
