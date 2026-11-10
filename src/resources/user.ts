import type { DirectoryMemberData } from '../types'

export class User {
  readonly id: string
  readonly login: string
  readonly displayName: string
  readonly deleted: boolean
  readonly avatarUrl: string | undefined
  readonly presenceStatus: string
  readonly customStatus: { emoji: string; text: string; expiresAt?: string } | undefined
  readonly roles: string[]
  readonly createdAt: string | undefined
  /** Markdown biography, when set. */
  readonly bio: string | undefined
  /** IANA time zone the user chose to share, when shared. */
  readonly timezone: string | undefined
  /** Owner of this bot account; `undefined` for humans. */
  readonly botOwnerId: string | undefined
  /** True while the account cannot use this server (data retained, restorable). */
  readonly deactivated: boolean

  constructor(data: DirectoryMemberData) {
    this.id = data.user.id
    this.login = data.user.login
    this.displayName = data.user.displayName
    this.deleted = data.user.deleted
    this.avatarUrl = data.user.avatarUrl
    this.presenceStatus = data.user.presenceStatus
    this.customStatus = data.user.customStatus
    this.roles = data.roles
    this.createdAt = data.createdAt
    this.bio = data.user.bio
    this.timezone = data.user.timezone
    this.botOwnerId = data.user.bot?.ownerUserId
    this.deactivated = data.user.deactivated ?? false
  }

  get username(): string {
    return this.login
  }

  /** True for bot accounts (the `bot` field is present). */
  get isBot(): boolean {
    return this.botOwnerId !== undefined
  }

  static partial(id: string): User {
    return new User({
      user: {
        id,
        login: id,
        displayName: id,
        deleted: false,
        avatarUrl: undefined,
        presenceStatus: 'PRESENCE_STATUS_UNSPECIFIED',
        customStatus: undefined,
        deactivated: false,
      },
      roles: [],
      createdAt: undefined,
    })
  }
}
