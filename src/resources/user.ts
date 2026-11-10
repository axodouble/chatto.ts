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
  }

  get username(): string {
    return this.login
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
