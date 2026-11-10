import type { ClientContext } from '../context'
import type { CustomStatus, CustomStatusInput } from '../types'
import { serializeExpiresAt } from '../account/presence'
import {
  SetPresenceResponseSchema,
  SetCustomStatusResponseSchema,
  DeleteCustomStatusResponseSchema,
} from '../schemas/user'

export class AccountManager {
  constructor(private readonly ctx: ClientContext) {}

  async updatePresence(status: string, userSelected: boolean): Promise<string> {
    const res = await this.ctx.rest.post(
      'chatto.api.v1.MyAccountService',
      'SetPresence',
      { status, userSelected },
      SetPresenceResponseSchema,
    )
    return res.status
  }

  async updateCustomStatus(input: CustomStatusInput): Promise<CustomStatus> {
    const res = await this.ctx.rest.post(
      'chatto.api.v1.MyAccountService',
      'SetCustomStatus',
      { emoji: input.emoji, text: input.text, expiresAt: serializeExpiresAt(input.expiresAt) },
      SetCustomStatusResponseSchema,
    )
    return res.status
  }

  async deleteCustomStatus(): Promise<void> {
    await this.ctx.rest.post(
      'chatto.api.v1.MyAccountService',
      'DeleteCustomStatus',
      {},
      DeleteCustomStatusResponseSchema,
    )
  }
}
