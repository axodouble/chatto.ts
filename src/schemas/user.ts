import { z } from 'zod'

import { PageInfoSchema } from './page'

export const PresenceStatusSchema = z.enum([
  'PRESENCE_STATUS_UNSPECIFIED',
  'PRESENCE_STATUS_ONLINE',
  'PRESENCE_STATUS_AWAY',
  'PRESENCE_STATUS_DO_NOT_DISTURB',
  'PRESENCE_STATUS_OFFLINE',
])

export const CustomUserStatusSchema = z.object({
  emoji: z.string(),
  text: z.string(),
  expiresAt: z.string().optional(),
})

export const UserSchema = z.object({
  id: z.string(),
  login: z.string().default(''),
  displayName: z.string().default(''),
  deleted: z.boolean().default(false),
  avatarUrl: z.string().optional(),
  // UNSPECIFIED (0) is omitted on the wire.
  presenceStatus: PresenceStatusSchema.catch('PRESENCE_STATUS_UNSPECIFIED').default('PRESENCE_STATUS_UNSPECIFIED'),
  customStatus: CustomUserStatusSchema.optional(),
  bio: z.string().optional(),
  timezone: z.string().optional(),
  /** Present for bot accounts. */
  bot: z.object({ ownerUserId: z.string().default('') }).optional(),
  deactivated: z.boolean().default(false),
})

export const DirectoryMemberSchema = z.object({
  user: UserSchema,
  roles: z.array(z.string()).default([]),
  createdAt: z.string().optional(),
})

export const GetUserResponseSchema = z.object({ user: DirectoryMemberSchema })
// proto3 JSON omits empty repeated fields, so `users` is absent when there are
// no results (e.g. a search matching nobody comes back as `{ page: {} }`).
export const BatchGetUsersResponseSchema = z.object({ users: z.array(DirectoryMemberSchema).default([]) })
export const ListUsersResponseSchema = z.object({
  users: z.array(DirectoryMemberSchema).default([]),
  page: PageInfoSchema.optional(),
})

export const SetPresenceResponseSchema = z.object({
  status: PresenceStatusSchema.catch('PRESENCE_STATUS_UNSPECIFIED').default('PRESENCE_STATUS_UNSPECIFIED'),
})

export const SetCustomStatusResponseSchema = z.object({
  status: CustomUserStatusSchema,
})

export const DeleteCustomStatusResponseSchema = z.object({
  status: CustomUserStatusSchema.optional(),
})

export type PresenceStatus = z.infer<typeof PresenceStatusSchema>

/** UpdateUserProfile / UploadAvatar / DeleteAvatar all return the bare public `User`. */
export const UserProfileResponseSchema = z.object({ user: UserSchema })
export const UpdateUserProfileResponseSchema = UserProfileResponseSchema
export const UploadAvatarResponseSchema = UserProfileResponseSchema
export const DeleteAvatarResponseSchema = UserProfileResponseSchema
