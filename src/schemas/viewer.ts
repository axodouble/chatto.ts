import { z } from 'zod'

import { UserSchema } from './user'
import { PermissionGrantSchema } from './room'
import { UserSettingsSchema, AccountActionsSchema } from './account'
import { CapabilityGrantSchema } from './permission'

export const ViewerUserSchema = z.object({
  hasVerifiedEmail: z.boolean().default(false),
  settings: UserSettingsSchema.optional(),
  /** @deprecated use `actions.deleteAccount` when present. */
  viewerCanDeleteAccount: z.boolean().default(false),
  lastLoginChange: z.string().optional(),
  profile: UserSchema.optional(),
  hasPassword: z.boolean().default(false),
  /** Absent on older servers. */
  actions: AccountActionsSchema.optional(),
})
export type ViewerUser = z.infer<typeof ViewerUserSchema>

export const ViewerCapabilitiesSchema = z.object({
  grants: z.array(CapabilityGrantSchema).default([]),
  hasUnreadFollowedThreads: z.boolean().default(false),
})
export type ViewerCapabilities = z.infer<typeof ViewerCapabilitiesSchema>

export const ServerViewerPermissionsSchema = z.object({
  permissions: z.array(PermissionGrantSchema).default([]),
})

export const ServerViewerStateSchema = z.object({
  hasUnreadRooms: z.boolean().default(false),
})

export const PrivilegedModeStateSchema = z.object({
  available: z.boolean().default(false),
  active: z.boolean().default(false),
  /** Present only while privileged mode is active. */
  expiresAt: z.string().optional(),
})
export type PrivilegedModeState = z.infer<typeof PrivilegedModeStateSchema>

export const GetViewerResponseSchema = z.object({
  user: ViewerUserSchema.prefault({}),
  capabilities: ViewerCapabilitiesSchema.prefault({}),
  viewerPermissions: ServerViewerPermissionsSchema.prefault({}),
  viewerState: ServerViewerStateSchema.prefault({}),
  privilegedMode: PrivilegedModeStateSchema.prefault({}),
})
export type Viewer = z.infer<typeof GetViewerResponseSchema>

export const PrivilegedModeResponseSchema = z.object({
  privilegedMode: PrivilegedModeStateSchema.prefault({}),
  capabilities: ViewerCapabilitiesSchema.prefault({}),
  viewerPermissions: ServerViewerPermissionsSchema.prefault({}),
})
export type PrivilegedModeResult = z.infer<typeof PrivilegedModeResponseSchema>
