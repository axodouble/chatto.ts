import type { ClientContext } from '../context'
import {
  GetServerProfileResponseSchema,
  GetMotdResponseSchema,
  GetRuntimeConfigResponseSchema,
  type ServerProfile,
  type ServerRuntimeConfig,
} from '../schemas/server'

const SERVICE = 'chatto.api.v1.ServerService'

/** Authenticated server-wide reads (`chatto.api.v1.ServerService`). */
export class ServerManager {
  constructor(private readonly ctx: ClientContext) {}

  /** Fetch the public server profile (name, version, branding). */
  async fetchProfile(): Promise<ServerProfile> {
    const res = await this.ctx.rest.post(SERVICE, 'GetServerProfile', {}, GetServerProfileResponseSchema)
    return res.profile
  }

  /** Fetch the message of the day, or `undefined` when none is set. */
  async fetchMotd(): Promise<string | undefined> {
    const res = await this.ctx.rest.post(SERVICE, 'GetMotd', {}, GetMotdResponseSchema)
    return res.motd
  }

  /** Fetch client runtime settings (upload limit, edit window, LiveKit/push config). */
  async fetchRuntimeConfig(): Promise<ServerRuntimeConfig> {
    const res = await this.ctx.rest.post(SERVICE, 'GetRuntimeConfig', {}, GetRuntimeConfigResponseSchema)
    return res.runtime
  }
}
