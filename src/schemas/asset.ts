import { z } from 'zod'

/**
 * Enums arrive from Connect JSON as their proto string names. `.catch` keeps the
 * SDK forward-compatible: unknown values fall back to the `_UNSPECIFIED` member.
 */
export const AssetUploadStatusSchema = z
  .enum([
    'ASSET_UPLOAD_STATUS_UNSPECIFIED',
    'ASSET_UPLOAD_STATUS_OPEN',
    'ASSET_UPLOAD_STATUS_COMPLETED',
    'ASSET_UPLOAD_STATUS_CANCELLED',
  ])
  .catch('ASSET_UPLOAD_STATUS_UNSPECIFIED')

export const MessageVideoProcessingStatusSchema = z
  .enum([
    'MESSAGE_VIDEO_PROCESSING_STATUS_UNSPECIFIED',
    'MESSAGE_VIDEO_PROCESSING_STATUS_PROCESSING',
    'MESSAGE_VIDEO_PROCESSING_STATUS_COMPLETED',
    'MESSAGE_VIDEO_PROCESSING_STATUS_FAILED',
  ])
  .catch('MESSAGE_VIDEO_PROCESSING_STATUS_UNSPECIFIED')

export const ImageFitModeSchema = z.enum([
  'IMAGE_FIT_MODE_UNSPECIFIED',
  'IMAGE_FIT_MODE_CONTAIN',
  'IMAGE_FIT_MODE_COVER',
])

/** proto3-JSON encodes int64 as a string; coerce it back to a number. */
const int64 = z.coerce.number()

export const MessageAssetUrlSchema = z.object({
  url: z.string(),
  expiresAt: z.string().optional(),
})

export const MessageVideoVariantSchema = z.object({
  quality: z.string(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  size: int64.optional(),
  assetUrl: MessageAssetUrlSchema.optional(),
})

export const MessageVideoProcessingSchema = z.object({
  status: MessageVideoProcessingStatusSchema,
  durationMs: int64.optional(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  sourceAvailable: z.boolean().optional(),
  reasonCode: z.string().optional(),
  thumbnailAssetUrl: MessageAssetUrlSchema.optional(),
  variants: z.array(MessageVideoVariantSchema).default([]),
  /** Adaptive-streaming (HLS) metadata, when the server produced it. */
  hls: z.object({ masterPlaylistUrl: MessageAssetUrlSchema.optional() }).optional(),
})

export const MessageAttachmentSchema = z.object({
  id: z.string(),
  filename: z.string(),
  contentType: z.string(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  assetUrl: MessageAssetUrlSchema.optional(),
  thumbnailAssetUrl: MessageAssetUrlSchema.optional(),
  videoProcessing: MessageVideoProcessingSchema.optional(),
  /** Accessibility description, when the attachment has one. */
  description: z.string().optional(),
})

export const AssetSchema = z.object({
  id: z.string(),
  filename: z.string(),
  contentType: z.string(),
  size: int64.optional(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  assetUrl: MessageAssetUrlSchema.optional(),
  thumbnailAssetUrl: MessageAssetUrlSchema.optional(),
  videoProcessing: MessageVideoProcessingSchema.optional(),
})

export const AssetUploadSchema = z.object({
  uploadId: z.string(),
  roomId: z.string(),
  status: AssetUploadStatusSchema,
  committedOffset: int64.default(0),
  size: int64.default(0),
  maxChunkSize: z.coerce.number().int(),
  sha256: z.string(),
  expiresAt: z.string().optional(),
  assetId: z.string().optional(),
})

export const ImageTransformOptionsSchema = z.object({
  width: z.number().int(),
  height: z.number().int(),
  fit: ImageFitModeSchema.optional(),
})

export const CreateUploadResponseSchema = z.object({ upload: AssetUploadSchema })
export const UploadChunkResponseSchema = z.object({ upload: AssetUploadSchema })
export const GetUploadResponseSchema = z.object({ upload: AssetUploadSchema })
export const CancelUploadResponseSchema = z.object({ upload: AssetUploadSchema })
export const CompleteUploadResponseSchema = z.object({
  upload: AssetUploadSchema,
  asset: AssetSchema,
})
export const GetAssetResponseSchema = z.object({ asset: AssetSchema })
export const BatchGetAssetsResponseSchema = z.object({
  assets: z.array(AssetSchema).default([]),
})
