import type { ClientContext } from '../context'
import type { FileInput, UserData } from '../types'
import { User } from '../resources/user'
import { ChattoValidationError } from '../errors'
import { toBase64, toUint8Array } from '../util/bytes'
import { pageRequest, toPage, type Page, type PageOptions } from '../util/page'
import { inferUpdateMask, stripNulls } from '../account/mask'
import {
  GetUserResponseSchema,
  BatchGetUsersResponseSchema,
  ListUsersResponseSchema,
  UpdateUserProfileResponseSchema,
  UploadAvatarResponseSchema,
  DeleteAvatarResponseSchema,
} from '../schemas/user'

const SERVICE = 'chatto.api.v1.UserService'

/** Options for listing users. */
export interface ListUsersOptions extends PageOptions {
  /** Case-insensitive search against login and display name (max 100 chars). */
  search?: string
}

/** Profile patch for `updateProfile`. */
export interface UpdateUserProfileInput {
  /** Non-empty display name, 1–32 chars. */
  displayName?: string
  /** New login, 2–32 chars of ASCII letters, digits, `.`, `_`, `-`. Subject to a cooldown. */
  login?: string
  /** Markdown bio, max 1000 chars. `''` or `null` clears it. */
  bio?: string | null
}

/** Reads users and manages public profiles and avatars (`chatto.api.v1.UserService`). */
export class UserManager {
  constructor(private readonly ctx: ClientContext) {}

  /** Fetch one visible user by ID. NOT_FOUND when unknown. */
  async fetch(userId: string): Promise<User> {
    const res = await this.ctx.rest.post(SERVICE, 'GetUser', { userId }, GetUserResponseSchema)
    return new User(res.user)
  }

  /** Fetch one visible user by login. NOT_FOUND when unknown. */
  async fetchByLogin(login: string): Promise<User> {
    const res = await this.ctx.rest.post(SERVICE, 'GetUser', { login }, GetUserResponseSchema)
    return new User(res.user)
  }

  /**
   * Fetch up to 100 users by ID. Unknown IDs are omitted; order follows the
   * first-seen request order with duplicates removed. Empty input returns `[]`.
   */
  async batchFetch(userIds: string[]): Promise<User[]> {
    if (userIds.length === 0) return []
    if (userIds.length > 100) {
      throw new ChattoValidationError('too_many_user_ids', 'At most 100 user IDs may be fetched at once')
    }
    const res = await this.ctx.rest.post(SERVICE, 'BatchGetUsers', { userIds }, BatchGetUsersResponseSchema)
    return res.users.map(m => new User(m))
  }

  /**
   * List visible users, oldest first. Returns one page (server default 20,
   * max 500 via `limit`); use `listPage` for paging metadata.
   */
  async list(opts: ListUsersOptions = {}): Promise<User[]> {
    return (await this.listPage(opts)).items
  }

  /** List visible users with paging metadata (`totalCount`, `hasMore`). */
  async listPage(opts: ListUsersOptions = {}): Promise<Page<User>> {
    if (opts.limit != null && (opts.limit < 0 || opts.limit > 500)) {
      throw new ChattoValidationError('invalid_limit', 'limit must be between 0 and 500')
    }
    const res = await this.ctx.rest.post(
      SERVICE,
      'ListUsers',
      { search: opts.search, page: pageRequest(opts) },
      ListUsersResponseSchema,
    )
    return toPage(res.users.map(m => new User(m)), res.page)
  }

  /**
   * Update a user's display name, login and/or bio. Self-updates are always
   * allowed; others need `user.manage-accounts` (or bot ownership / `bot.manage`
   * for bots). Only given keys are changed unless `updateMask` is passed.
   * Returns the updated public profile (no directory roles).
   */
  async updateProfile(
    userId: string,
    input: UpdateUserProfileInput,
    opts: { updateMask?: string } = {},
  ): Promise<UserData> {
    const updateMask = opts.updateMask ?? inferUpdateMask(input as Record<string, unknown>)
    if (updateMask === '') {
      throw new ChattoValidationError('empty_update', 'updateProfile needs at least one field')
    }
    const res = await this.ctx.rest.post(
      SERVICE,
      'UpdateUserProfile',
      { userId, ...stripNulls(input as Record<string, unknown>), updateMask },
      UpdateUserProfileResponseSchema,
    )
    return res.user
  }

  /**
   * Upload and set a user's avatar. The server validates, resizes and stores
   * it as WebP. Same authorization as `updateProfile`.
   */
  async uploadAvatar(userId: string, file: FileInput): Promise<UserData> {
    const bytes = toUint8Array(file.data)
    if (bytes.length === 0) throw new ChattoValidationError('empty_image', 'Avatar image is empty')
    const res = await this.ctx.rest.post(
      SERVICE,
      'UploadAvatar',
      {
        userId,
        image: { image: toBase64(bytes), filename: file.filename, contentType: file.contentType },
      },
      UploadAvatarResponseSchema,
    )
    return res.user
  }

  /** Remove a user's avatar. Idempotent. Same authorization as `updateProfile`. */
  async deleteAvatar(userId: string): Promise<UserData> {
    const res = await this.ctx.rest.post(SERVICE, 'DeleteAvatar', { userId }, DeleteAvatarResponseSchema)
    return res.user
  }
}
