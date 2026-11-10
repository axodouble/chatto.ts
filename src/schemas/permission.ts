import { z } from 'zod'

export const CapabilityGrantSchema = z.object({
  capability: z.string().default(''),
  granted: z.boolean().default(false),
})
export type CapabilityGrant = z.infer<typeof CapabilityGrantSchema>

export const EffectivePermissionScopeKindSchema = z
  .enum([
    'EFFECTIVE_PERMISSION_SCOPE_KIND_UNSPECIFIED',
    'EFFECTIVE_PERMISSION_SCOPE_KIND_SERVER',
    'EFFECTIVE_PERMISSION_SCOPE_KIND_GROUP',
    'EFFECTIVE_PERMISSION_SCOPE_KIND_ROOM',
    'EFFECTIVE_PERMISSION_SCOPE_KIND_DM',
  ])
  .catch('EFFECTIVE_PERMISSION_SCOPE_KIND_UNSPECIFIED')
  .default('EFFECTIVE_PERMISSION_SCOPE_KIND_UNSPECIFIED')

export const EffectivePermissionScopeSchema = z.object({
  kind: EffectivePermissionScopeKindSchema,
  /** Room or group ID; empty for server and DM scopes. */
  id: z.string().default(''),
  name: z.string().default(''),
  parentGroupId: z.string().default(''),
})

export const EffectivePermissionSchema = z.object({
  permission: z.string().default(''),
  scope: EffectivePermissionScopeSchema.prefault({}),
  coversDescendants: z.boolean().default(false),
})
export type EffectivePermission = z.infer<typeof EffectivePermissionSchema>
export type EffectivePermissionScope = z.infer<typeof EffectivePermissionScopeSchema>

export const ListEffectivePermissionsResponseSchema = z.object({
  permissions: z.array(EffectivePermissionSchema).default([]),
})
