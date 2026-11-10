import type { ClientContext } from '../../context'
import type { FileInput } from '../../types'
import { ChattoValidationError } from '../../errors'
import { toBase64, toUint8Array } from '../../util/bytes'
import type { ServerProfile } from '../../schemas/server'
import {
  AdminServerConfigResponseSchema,
  AdminServerProfileResponseSchema,
  ServerSecurityConfigSchema,
  ListNeighborsResponseSchema,
  NeighborResponseSchema,
  AdminServerEmptyResponseSchema,
  type AccountCreationPolicy,
  type AdminServerConfig,
  type ServerSecurityConfig,
  type Neighbor,
} from '../../schemas/admin/server'

const SERVICE = 'chatto.admin.v1.AdminServerService'

/**
 * Patch for {@link AdminServerManager.updateConfig}. Only given keys change;
 * `''` clears a text field and `null` resets a field to its default.
 */
export interface UpdateServerConfigInput {
  /** Page-title server name (max 80); `''` uses the default. */
  serverName?: string | null
  /** Link-preview description (max 500). */
  description?: string | null
  /** Message of the day (max 1000). */
  motd?: string | null
  /** Login-page welcome message (max 10000). */
  welcomeMessage?: string | null
  /** Account creation policy; `null` resets to open. */
  admission?: Exclude<AccountCreationPolicy, 'ACCOUNT_CREATION_POLICY_UNSPECIFIED'> | null
}

/** Options for patch-style updates. */
export interface ServerUpdateMaskOptions {
  /** Explicit FieldMask (comma-separated camelCase paths, or `*`). Inferred from the given keys by default. */
  updateMask?: string
}

const TEXT_LIMITS = {
  serverName: 80,
  description: 500,
  motd: 1000,
  welcomeMessage: 10000,
} as const

function imageInput(file: FileInput, what: string): { image: string; filename: string; contentType?: string } {
  const bytes = toUint8Array(file.data)
  if (bytes.length === 0) throw new ChattoValidationError('empty_image', `${what} image is empty`)
  return { image: toBase64(bytes), filename: file.filename, contentType: file.contentType }
}

/**
 * Server administration (`chatto.admin.v1.AdminServerService`): runtime
 * settings, branding (logo/banner), blocked usernames and the Neighbor
 * directory.
 *
 * Settings/branding/security calls require `server.manage`; Neighbor calls
 * require `server.manage-neighbors`. For admins that usually means activating
 * privileged mode first via `client.viewer.activatePrivilegedMode()`.
 */
export class AdminServerManager {
  constructor(private readonly ctx: ClientContext) {}

  // --- Settings --------------------------------------------------------------

  /** Get runtime-editable settings plus the effective public profile. Requires `server.manage`. */
  async getConfig(): Promise<AdminServerConfig> {
    return this.ctx.rest.post(SERVICE, 'GetServerConfig', {}, AdminServerConfigResponseSchema)
  }

  /**
   * Patch runtime-editable settings (name, description, MOTD, welcome
   * message, registration admission). Returns the updated settings and public
   * profile. Requires `server.manage`.
   */
  async updateConfig(input: UpdateServerConfigInput, opts: ServerUpdateMaskOptions = {}): Promise<AdminServerConfig> {
    const body: Record<string, unknown> = {}
    const mask: string[] = []
    for (const key of Object.keys(TEXT_LIMITS) as (keyof typeof TEXT_LIMITS)[]) {
      const value = input[key]
      if (value === undefined) continue
      mask.push(key)
      if (value === null) continue
      if (value.length > TEXT_LIMITS[key]) {
        throw new ChattoValidationError(`invalid_${key}`, `${key} must be at most ${TEXT_LIMITS[key]} characters`)
      }
      body[key] = value
    }
    if (input.admission !== undefined) {
      mask.push('registration.admission')
      body.registration = input.admission === null ? {} : { admission: input.admission }
    }
    const updateMask = opts.updateMask ?? mask.join(',')
    if (updateMask === '') {
      throw new ChattoValidationError('empty_update', 'updateConfig needs at least one field')
    }
    body.updateMask = updateMask
    return this.ctx.rest.post(SERVICE, 'UpdateServerConfig', body, AdminServerConfigResponseSchema)
  }

  // --- Branding --------------------------------------------------------------

  /** Upload and set the server logo (validated, resized, stored as WebP). Requires `server.manage`. */
  async uploadLogo(file: FileInput): Promise<ServerProfile> {
    const res = await this.ctx.rest.post(
      SERVICE,
      'UploadServerLogo',
      { image: imageInput(file, 'Logo') },
      AdminServerProfileResponseSchema,
    )
    return res.publicProfile
  }

  /** Clear the server logo. Requires `server.manage`. */
  async deleteLogo(): Promise<ServerProfile> {
    const res = await this.ctx.rest.post(SERVICE, 'DeleteServerLogo', {}, AdminServerProfileResponseSchema)
    return res.publicProfile
  }

  /** Upload and set the server banner (validated, resized, stored as WebP). Requires `server.manage`. */
  async uploadBanner(file: FileInput): Promise<ServerProfile> {
    const res = await this.ctx.rest.post(
      SERVICE,
      'UploadServerBanner',
      { image: imageInput(file, 'Banner') },
      AdminServerProfileResponseSchema,
    )
    return res.publicProfile
  }

  /** Clear the server banner. Requires `server.manage`. */
  async deleteBanner(): Promise<ServerProfile> {
    const res = await this.ctx.rest.post(SERVICE, 'DeleteServerBanner', {}, AdminServerProfileResponseSchema)
    return res.publicProfile
  }

  // --- Security --------------------------------------------------------------

  /** Get security-sensitive settings (blocked usernames). Requires `server.manage`. */
  async getSecurityConfig(): Promise<ServerSecurityConfig> {
    return this.ctx.rest.post(SERVICE, 'GetServerSecurityConfig', {}, ServerSecurityConfigSchema)
  }

  /**
   * Replace the blocked-username list (max 1000 entries; `[]` clears it).
   * Entries are normalized server-side. Returns the effective list. Requires
   * `server.manage`.
   */
  async setBlockedUsernames(blockedUsernames: string[]): Promise<string[]> {
    if (blockedUsernames.length > 1000) {
      throw new ChattoValidationError('too_many_blocked_usernames', 'At most 1000 blocked usernames are allowed')
    }
    const res = await this.ctx.rest.post(
      SERVICE,
      'UpdateBlockedUsernames',
      { blockedUsernames, updateMask: 'blockedUsernames' },
      ServerSecurityConfigSchema,
    )
    return res.blockedUsernames
  }

  // --- Neighbors -------------------------------------------------------------

  /** List configured Neighbors (no ordering contract). Requires `server.manage-neighbors`. */
  async listNeighbors(): Promise<Neighbor[]> {
    const res = await this.ctx.rest.post(SERVICE, 'ListNeighbors', {}, ListNeighborsResponseSchema)
    return res.neighbors
  }

  /** Get one configured Neighbor. Requires `server.manage-neighbors`. */
  async fetchNeighbor(neighborId: string): Promise<Neighbor> {
    const res = await this.ctx.rest.post(SERVICE, 'GetNeighbor', { neighborId }, NeighborResponseSchema)
    return res.neighbor
  }

  /**
   * Advertise a server origin (HTTP(S), max 2048 chars; must not be this
   * server). Requires `server.manage-neighbors`.
   */
  async createNeighbor(origin: string): Promise<Neighbor> {
    checkOrigin(origin)
    const res = await this.ctx.rest.post(SERVICE, 'CreateNeighbor', { origin }, NeighborResponseSchema)
    return res.neighbor
  }

  /**
   * Change a Neighbor's origin. `revision` must be the Neighbor's current
   * revision (optimistic concurrency). Requires `server.manage-neighbors`.
   */
  async updateNeighbor(neighborId: string, input: { origin: string; revision: string }): Promise<Neighbor> {
    checkOrigin(input.origin)
    const res = await this.ctx.rest.post(
      SERVICE,
      'UpdateNeighbor',
      { neighborId, origin: input.origin, revision: input.revision, updateMask: 'origin' },
      NeighborResponseSchema,
    )
    return res.neighbor
  }

  /**
   * Stop advertising a Neighbor. `revision` must be its current revision.
   * Requires `server.manage-neighbors`.
   */
  async deleteNeighbor(neighborId: string, revision: string): Promise<void> {
    await this.ctx.rest.post(SERVICE, 'DeleteNeighbor', { neighborId, revision }, AdminServerEmptyResponseSchema)
  }
}

function checkOrigin(origin: string): void {
  if (origin.length === 0 || origin.length > 2048) {
    throw new ChattoValidationError('invalid_origin', 'Neighbor origin must be 1–2048 characters')
  }
}
