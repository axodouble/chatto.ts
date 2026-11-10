import { z } from 'zod'
import { PageInfoSchema } from '../page'
import { RoleSchema } from '../role'

export const PERMISSION_DECISIONS = [
  'PERMISSION_DECISION_UNSPECIFIED',
  'PERMISSION_DECISION_ALLOW',
  'PERMISSION_DECISION_DENY',
  'PERMISSION_DECISION_NONE',
] as const
/** Trinary permission decision. `NONE` = no explicit decision (clears state on writes). */
export const PermissionDecisionSchema = z
  .enum(PERMISSION_DECISIONS)
  .catch('PERMISSION_DECISION_UNSPECIFIED')
  .default('PERMISSION_DECISION_UNSPECIFIED')
export type PermissionDecision = (typeof PERMISSION_DECISIONS)[number]

export const PERMISSION_SCOPE_KINDS = [
  'PERMISSION_SCOPE_KIND_UNSPECIFIED',
  'PERMISSION_SCOPE_KIND_SERVER',
  'PERMISSION_SCOPE_KIND_GROUP',
  'PERMISSION_SCOPE_KIND_ROOM',
  'PERMISSION_SCOPE_KIND_DM',
] as const
/** Permission scope tier. `DM` is the server-wide "Direct messages" tier. */
export const PermissionScopeKindSchema = z
  .enum(PERMISSION_SCOPE_KINDS)
  .catch('PERMISSION_SCOPE_KIND_UNSPECIFIED')
  .default('PERMISSION_SCOPE_KIND_UNSPECIFIED')
export type PermissionScopeKind = (typeof PERMISSION_SCOPE_KINDS)[number]

export const PERMISSION_DECISION_LEVELS = [
  'PERMISSION_DECISION_LEVEL_UNSPECIFIED',
  'PERMISSION_DECISION_LEVEL_SERVER',
  'PERMISSION_DECISION_LEVEL_GROUP',
  'PERMISSION_DECISION_LEVEL_ROOM',
  'PERMISSION_DECISION_LEVEL_DM',
] as const
export const PermissionDecisionLevelSchema = z
  .enum(PERMISSION_DECISION_LEVELS)
  .catch('PERMISSION_DECISION_LEVEL_UNSPECIFIED')
  .default('PERMISSION_DECISION_LEVEL_UNSPECIFIED')
export type PermissionDecisionLevel = (typeof PERMISSION_DECISION_LEVELS)[number]

/** Typed scope reference. `id` is empty for server and DM scopes. */
export const PermissionScopeSchema = z.object({
  kind: PermissionScopeKindSchema,
  id: z.string().default(''),
})
export type PermissionScope = z.infer<typeof PermissionScopeSchema>

// ---- Tier matrix ------------------------------------------------------------

export const TierPermissionsSchema = z.object({
  permissions: z.array(z.string()).default([]),
  permissionDenials: z.array(z.string()).default([]),
})

export const TierRoleSchema = z.object({
  role: RoleSchema,
  /** Explicit state at this tier. */
  override: TierPermissionsSchema.prefault({}),
  inheritedAllows: z.array(z.string()).default([]),
  inheritedDenials: z.array(z.string()).default([]),
})
export type TierRole = z.infer<typeof TierRoleSchema>

export const TierRolesSchema = z.object({
  applicablePermissions: z.array(z.string()).default([]),
  /** Roles sorted by position. */
  roles: z.array(TierRoleSchema).default([]),
})
/** Role-permission matrix for a single tier. */
export type RolePermissionTierMatrix = z.infer<typeof TierRolesSchema>

export const GetRolePermissionTierMatrixResponseSchema = z.object({ matrix: TierRolesSchema.prefault({}) })

// ---- Full matrices -------------------------------------------------------------

export const PermissionMatrixScopeSchema = z.object({
  /** Stable column ID, e.g. `server`, `dm`, `group:G…`, `room:R…`. */
  id: z.string().default(''),
  /** Human-readable label, e.g. "Direct messages". */
  label: z.string().default(''),
  kind: PermissionScopeKindSchema,
  /** Parent group ID for room scopes. */
  parentGroupId: z.string().default(''),
})
export type PermissionMatrixScope = z.infer<typeof PermissionMatrixScopeSchema>

export const PermissionMatrixCellSchema = z.object({
  permission: z.string().default(''),
  /** Matches `PermissionMatrixScope.id`. */
  scopeId: z.string().default(''),
  /** Explicit decision at this scope. */
  override: PermissionDecisionSchema,
  /** Effective decision at this scope. */
  effective: PermissionDecisionSchema,
  /** Whether an explicit allow may be stored; absent when no delegation ceiling applies. */
  allowPermitted: z.boolean().optional(),
})
export type PermissionMatrixCell = z.infer<typeof PermissionMatrixCellSchema>

export const RolePermissionMatrixSchema = z.object({
  roleName: z.string().default(''),
  applicablePermissions: z.array(z.string()).default([]),
  scopes: z.array(PermissionMatrixScopeSchema).default([]),
  /** Sparse cells. */
  cells: z.array(PermissionMatrixCellSchema).default([]),
})
export type RolePermissionMatrix = z.infer<typeof RolePermissionMatrixSchema>

export const UserPermissionMatrixSchema = z.object({
  userId: z.string().default(''),
  applicablePermissions: z.array(z.string()).default([]),
  scopes: z.array(PermissionMatrixScopeSchema).default([]),
  /** Sparse cells. */
  cells: z.array(PermissionMatrixCellSchema).default([]),
})
export type UserPermissionMatrix = z.infer<typeof UserPermissionMatrixSchema>

export const GetRolePermissionMatrixResponseSchema = z.object({ matrix: RolePermissionMatrixSchema.prefault({}) })
export const GetUserPermissionMatrixResponseSchema = z.object({ matrix: UserPermissionMatrixSchema.prefault({}) })

// ---- Decision lists ------------------------------------------------------------

export const ScopedPermissionDecisionSchema = z.object({
  permission: z.string().default(''),
  scope: PermissionScopeSchema.prefault({}),
  /** Explicit decision stored at this scope. */
  override: PermissionDecisionSchema,
  /** Effective decision after inherited broader scopes are applied. */
  effective: PermissionDecisionSchema,
})
export type ScopedPermissionDecision = z.infer<typeof ScopedPermissionDecisionSchema>

export const ListRolePermissionDecisionsResponseSchema = z.object({
  roleName: z.string().default(''),
  decisions: z.array(ScopedPermissionDecisionSchema).default([]),
  page: PageInfoSchema.optional(),
  scopes: z.array(PermissionScopeSchema).default([]),
})
export const ListUserPermissionDecisionsResponseSchema = z.object({
  userId: z.string().default(''),
  decisions: z.array(ScopedPermissionDecisionSchema).default([]),
  page: PageInfoSchema.optional(),
  scopes: z.array(PermissionScopeSchema).default([]),
})

/**
 * One page of permission decisions. Pagination counts **scopes**, not
 * decisions: advance `offset` by `scopes.length`.
 */
export interface PermissionDecisionPage {
  decisions: ScopedPermissionDecision[]
  /** Scopes in this page, including ones without applicable decisions. */
  scopes: PermissionScope[]
  /** Total matching scopes. */
  totalCount: number
  hasMore: boolean
}

// ---- Explanations --------------------------------------------------------------

export const PermissionTraceEntrySchema = z.object({
  level: PermissionDecisionLevelSchema,
  /** Role name, user ID, or policy marker (e.g. `@bot-allowlist`). */
  roleName: z.string().default(''),
  decision: PermissionDecisionSchema,
  applied: z.boolean().default(false),
})
export type PermissionTraceEntry = z.infer<typeof PermissionTraceEntrySchema>

export const PermissionExplanationSchema = z.object({
  permission: z.string().default(''),
  /** Overall decision. */
  state: PermissionDecisionSchema,
  /** Level of the winning decision (when `state` is not NONE). */
  decidedAt: PermissionDecisionLevelSchema,
  /** Role name, user ID, or policy marker that produced the winning decision. */
  decidedByRole: z.string().default(''),
  /** Ordered trace; the first entry is the winning decision. */
  trace: z.array(PermissionTraceEntrySchema).default([]),
  /** Permission whose allow implies this one; empty when resolved directly. */
  includedByPermission: z.string().default(''),
})
export type PermissionExplanation = z.infer<typeof PermissionExplanationSchema>

export const ExplainPermissionsResponseSchema = z.object({
  explanations: z.array(PermissionExplanationSchema).default([]),
})

// ---- Writes ------------------------------------------------------------------

export const PermissionDecisionUpdateSchema = z.object({
  permission: z.string().default(''),
  scope: PermissionScopeSchema.prefault({}),
  /** Stored decision after the write. NONE means no explicit decision remains. */
  decision: PermissionDecisionSchema,
})
export type PermissionDecisionUpdate = z.infer<typeof PermissionDecisionUpdateSchema>

export const SetPermissionResponseSchema = z.object({ decision: PermissionDecisionUpdateSchema.prefault({}) })
