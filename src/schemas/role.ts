import { z } from 'zod'

export const RoleSchema = z.object({
  name: z.string(),
  displayName: z.string().default(''),
  description: z.string().default(''),
  isSystem: z.boolean().default(false),
  position: z.number().default(0),
  pingable: z.boolean().default(false),
})
export type Role = z.infer<typeof RoleSchema>

export const RolesResponseSchema = z.object({ roles: z.array(RoleSchema).default([]) })
export const GetRoleResponseSchema = z.object({ role: RoleSchema })
