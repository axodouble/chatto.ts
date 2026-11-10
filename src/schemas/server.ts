import { z } from 'zod'

export const ServerPublicProfileSchema = z.object({
  name: z.string().default(''),
  version: z.string().default(''),
  logoUrl: z.string().optional(),
  bannerUrl: z.string().optional(),
  welcomeMessage: z.string().optional(),
  description: z.string().optional(),
})
export type ServerProfile = z.infer<typeof ServerPublicProfileSchema>

export const GetServerProfileResponseSchema = z.object({
  profile: ServerPublicProfileSchema.prefault({}),
})

export const GetMotdResponseSchema = z.object({ motd: z.string().optional() })

export const ServerRuntimeConfigSchema = z.object({
  pushNotificationsEnabled: z.boolean().default(false),
  vapidPublicKey: z.string().optional(),
  livekitUrl: z.string().optional(),
  videoProcessingEnabled: z.boolean().default(false),
  /** Maximum upload size in bytes for all files. */
  maxUploadSize: z.coerce.number().default(0),
  /** @deprecated alias of `maxUploadSize`. */
  maxVideoUploadSize: z.coerce.number().default(0),
  messageEditWindowSeconds: z.number().default(0),
})
export type ServerRuntimeConfig = z.infer<typeof ServerRuntimeConfigSchema>

export const GetRuntimeConfigResponseSchema = z.object({
  runtime: ServerRuntimeConfigSchema.prefault({}),
})
