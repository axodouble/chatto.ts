import type { ClientContext } from '../context'
import type { CustomStatus, CustomStatusInput, UserData } from '../types'
import { serializeExpiresAt, toPresenceStatus, type PresenceStatusInput } from '../account/presence'
import { inferUpdateMask, stripNulls } from '../account/mask'
import { ChattoApiError, ChattoValidationError } from '../errors'
import {
  SetPresenceResponseSchema,
  SetCustomStatusResponseSchema,
  DeleteCustomStatusResponseSchema,
} from '../schemas/user'
import {
  ChangePasswordResponseSchema,
  VerifiedEmailsResponseSchema,
  EmptyResponseSchema,
  GetSettingsResponseSchema,
  UpdateSettingsResponseSchema,
  ListExternalIdentitiesResponseSchema,
  StartExternalIdentityLinkResponseSchema,
  PresencePreferenceResponseSchema,
  RequestAccountDeletionResponseSchema,
  type VerifiedEmail,
  type UserSettings,
  type TimeFormat,
  type ExternalIdentities,
  type PresencePreference,
} from '../schemas/account'
import { GetViewerResponseSchema } from '../schemas/viewer'

const SERVICE = 'chatto.api.v1.MyAccountService'

/** Patch for `updateSettings`. `null` resets a field to its default. */
export interface UpdateSettingsInput {
  /** IANA timezone override. `''` = explicitly use device-local time; `null` clears the override. */
  timezone?: string | null
  /** `null` (or `TIME_FORMAT_UNSPECIFIED`) restores the automatic format. */
  timeFormat?: TimeFormat | null
  /** Whether the timezone may appear on the public profile. */
  shareTimezone?: boolean | null
}

/** Options for the verified-email RPCs. */
export interface ExpectedUserOptions {
  /**
   * User ID the caller expects to be authenticated as. The server returns
   * FAILED_PRECONDITION when it doesn't match. Resolved via GetViewer when omitted.
   */
  expectedUserId?: string
}

/**
 * Self-service commands for the authenticated account
 * (`chatto.api.v1.MyAccountService`).
 *
 * Presence model (Chatto 0.5.0): the *saved choice* (`setPresencePreference`)
 * is private, persists across devices/disconnects, and decides what others
 * see; *liveness* (`refreshPresence`, every ~30s, expires after 60s) decides
 * whether that choice is shown or the account appears offline. `updatePresence`
 * (SetPresence) is the legacy live report and is overridden by any saved choice.
 */
export class AccountManager {
  constructor(private readonly ctx: ClientContext) {}

  // ---- Presence -----------------------------------------------------------

  /**
   * Legacy live presence report (SetPresence); expires after 60s without a
   * refresh. OFFLINE is rejected. A saved presence preference takes precedence
   * over this report — prefer `setPresencePreference` + `refreshPresence`.
   */
  async updatePresence(status: string, userSelected: boolean): Promise<string> {
    const res = await this.ctx.rest.post(SERVICE, 'SetPresence', { status, userSelected }, SetPresenceResponseSchema)
    return res.status
  }

  /** Read the account's private saved presence choice, or `undefined` if none was ever saved. */
  async getPresencePreference(): Promise<PresencePreference | undefined> {
    const res = await this.ctx.rest.post(SERVICE, 'GetPresencePreference', {}, PresencePreferenceResponseSchema)
    return res.preference
  }

  /**
   * Save an explicit presence choice for all devices (SetPresencePreference).
   * `offline`/`invisible` = "Appear Offline" (suppresses presence and typing);
   * `dnd` suppresses alerts even while disconnected. Do not call this as a
   * heartbeat — use `refreshPresence`.
   *
   * The server uses optimistic concurrency: pass `expectedRevision` from a
   * previous read to fail with ABORTED on a stale write. When omitted, the
   * current revision is read first and the write is retried once on ABORTED.
   */
  async setPresencePreference(
    status: PresenceStatusInput,
    opts: { expectedRevision?: string } = {},
  ): Promise<PresencePreference> {
    const wire = toPresenceStatus(status)
    const send = async (expectedRevision: string) => {
      const res = await this.ctx.rest.post(
        SERVICE,
        'SetPresencePreference',
        { status: wire, expectedRevision },
        PresencePreferenceResponseSchema,
      )
      return res.preference ?? { status: wire, revision: '' }
    }
    if (opts.expectedRevision != null) return send(opts.expectedRevision)
    const current = await this.getPresencePreference()
    try {
      return await send(current?.revision ?? '')
    } catch (err) {
      if (!(err instanceof ChattoApiError) || err.code !== 'aborted') throw err
      const fresh = await this.getPresencePreference()
      return send(fresh?.revision ?? '')
    }
  }

  /**
   * Refresh connection liveness without changing the saved choice. Call every
   * 30 seconds while connected; liveness expires after 60 seconds. Returns the
   * saved choice (absent if none) so clients can pick up changes from other devices.
   */
  async refreshPresence(): Promise<PresencePreference | undefined> {
    const res = await this.ctx.rest.post(SERVICE, 'RefreshPresence', {}, PresencePreferenceResponseSchema)
    return res.preference
  }

  // ---- Custom status ------------------------------------------------------

  /** Replace the complete custom status (emoji 1–16 chars, text 1–100 chars, optional future expiry). */
  async updateCustomStatus(input: CustomStatusInput): Promise<CustomStatus> {
    const res = await this.ctx.rest.post(
      SERVICE,
      'SetCustomStatus',
      { emoji: input.emoji, text: input.text, expiresAt: serializeExpiresAt(input.expiresAt) },
      SetCustomStatusResponseSchema,
    )
    return res.status
  }

  /** Clear the custom status. Idempotent. */
  async deleteCustomStatus(): Promise<void> {
    await this.ctx.rest.post(SERVICE, 'DeleteCustomStatus', {}, DeleteCustomStatusResponseSchema)
  }

  // ---- Password -----------------------------------------------------------

  /**
   * Change the password (8–128 chars), or add a first password to a
   * passwordless account. `currentPassword` is required when one already exists.
   * Returns the updated public profile.
   */
  async changePassword(password: string, opts: { currentPassword?: string } = {}): Promise<UserData | undefined> {
    if (password.length < 8 || password.length > 128) {
      throw new ChattoValidationError('invalid_password_length', 'Password must be 8–128 characters')
    }
    const res = await this.ctx.rest.post(
      SERVICE,
      'ChangePassword',
      { password, currentPassword: opts.currentPassword },
      ChangePasswordResponseSchema,
    )
    return res.user
  }

  // ---- Verified emails ----------------------------------------------------

  /** List verified email addresses and which one is primary. */
  async listVerifiedEmails(opts: ExpectedUserOptions = {}): Promise<VerifiedEmail[]> {
    const expectedUserId = await this.expectedUserId(opts)
    const res = await this.ctx.rest.post(SERVICE, 'ListVerifiedEmails', { expectedUserId }, VerifiedEmailsResponseSchema)
    return res.verifiedEmails
  }

  /**
   * Send a six-digit verification code to a new address. Requires server email
   * delivery; RESOURCE_EXHAUSTED when rate-limited, ALREADY_EXISTS when already verified.
   */
  async requestEmailVerification(email: string, opts: ExpectedUserOptions = {}): Promise<void> {
    const expectedUserId = await this.expectedUserId(opts)
    await this.ctx.rest.post(SERVICE, 'RequestEmailVerification', { email, expectedUserId }, EmptyResponseSchema)
  }

  /** Confirm a verification code and add the address. Returns the updated list. */
  async confirmEmailVerification(email: string, code: string, opts: ExpectedUserOptions = {}): Promise<VerifiedEmail[]> {
    const expectedUserId = await this.expectedUserId(opts)
    const res = await this.ctx.rest.post(
      SERVICE,
      'ConfirmEmailVerification',
      { email, code, expectedUserId },
      VerifiedEmailsResponseSchema,
    )
    return res.verifiedEmails
  }

  /** Select a verified address as primary for account email. Returns the updated list. */
  async setPrimaryEmail(email: string, opts: ExpectedUserOptions = {}): Promise<VerifiedEmail[]> {
    const expectedUserId = await this.expectedUserId(opts)
    const res = await this.ctx.rest.post(SERVICE, 'SetPrimaryEmail', { email, expectedUserId }, VerifiedEmailsResponseSchema)
    return res.verifiedEmails
  }

  // ---- Settings -----------------------------------------------------------

  /** Read display preferences (defaults when none saved). */
  async getSettings(): Promise<UserSettings> {
    const res = await this.ctx.rest.post(SERVICE, 'GetSettings', {}, GetSettingsResponseSchema)
    return res.settings
  }

  /**
   * Patch display preferences. Only the given keys are changed; a `null` value
   * resets that field. Pass `updateMask: '*'` to reset every unspecified field.
   */
  async updateSettings(input: UpdateSettingsInput, opts: { updateMask?: string } = {}): Promise<UserSettings> {
    const updateMask = opts.updateMask ?? inferUpdateMask(input as Record<string, unknown>)
    if (updateMask === '') {
      throw new ChattoValidationError('empty_update', 'updateSettings needs at least one field')
    }
    const res = await this.ctx.rest.post(
      SERVICE,
      'UpdateSettings',
      { ...stripNulls(input as Record<string, unknown>), updateMask },
      UpdateSettingsResponseSchema,
    )
    return res.settings
  }

  // ---- External identities ------------------------------------------------

  /** List configured external login providers and identities linked to this account. */
  async listExternalIdentities(): Promise<ExternalIdentities> {
    return this.ctx.rest.post(SERVICE, 'ListExternalIdentities', {}, ListExternalIdentitiesResponseSchema)
  }

  /**
   * Start linking a provider identity. Returns a short-lived browser URL; the
   * provider round-trip must then be completed in a browser.
   */
  async startExternalIdentityLink(
    providerId: string,
    opts: { redirectPath?: string; currentPassword?: string } = {},
  ): Promise<string> {
    const res = await this.ctx.rest.post(
      SERVICE,
      'StartExternalIdentityLink',
      { providerId, redirectPath: opts.redirectPath, currentPassword: opts.currentPassword },
      StartExternalIdentityLinkResponseSchema,
    )
    return res.startUrl
  }

  /**
   * Disconnect a linked identity by its `subjectHash`. `currentPassword` may be
   * required when the session credential is no longer fresh.
   */
  async disconnectExternalIdentity(subjectHash: string, opts: { currentPassword?: string } = {}): Promise<void> {
    await this.ctx.rest.post(
      SERVICE,
      'DisconnectExternalIdentity',
      { subjectHash, currentPassword: opts.currentPassword },
      EmptyResponseSchema,
    )
  }

  // ---- Account deletion ---------------------------------------------------

  /** Issue a short-lived confirmation token for `deleteMyAccount`. Requires `user.delete-self`. */
  async requestAccountDeletion(): Promise<string> {
    const res = await this.ctx.rest.post(SERVICE, 'RequestAccountDeletion', {}, RequestAccountDeletionResponseSchema)
    return res.confirmationToken
  }

  /** Permanently delete the authenticated account. Irreversible. Requires `user.delete-self`. */
  async deleteMyAccount(confirmationToken: string): Promise<void> {
    await this.ctx.rest.post(SERVICE, 'DeleteMyAccount', { confirmationToken }, EmptyResponseSchema)
  }

  private async expectedUserId(opts: ExpectedUserOptions): Promise<string> {
    if (opts.expectedUserId != null) return opts.expectedUserId
    const viewer = await this.ctx.rest.post('chatto.api.v1.ViewerService', 'GetViewer', {}, GetViewerResponseSchema)
    const id = viewer.user.profile?.id
    if (id == null) throw new ChattoValidationError('unknown_viewer', 'Could not resolve the authenticated user ID')
    return id
  }
}
