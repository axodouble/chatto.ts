import type { RestClient } from './rest/client'
import type { MessageData } from './types'
import { Message } from './resources/message'
import { User } from './resources/user'
import { Room } from './resources/room'
import { UserManager } from './managers/users'
import { RoomManager } from './managers/rooms'
import { MessageManager } from './managers/messages'
import { ThreadManager } from './managers/threads'
import { AssetManager } from './managers/assets'
import { AccountManager } from './managers/account'
import { ViewerManager } from './managers/viewer'
import { PermissionManager } from './managers/permissions'
import { RoleManager } from './managers/roles'
import { ServerManager } from './managers/server'
import { VoiceCallManager } from './managers/voice'
import { PushNotificationManager } from './managers/push'
import { BotManager } from './managers/bots'
import { SearchManager } from './managers/search'
import { NotificationManager } from './managers/notifications'
import { UserCache, RoomCache } from './caches'

export interface ClientContext {
  readonly rest: RestClient
  readonly assets: AssetManager
  readonly account: AccountManager
  resolveUser(id: string): Promise<User>
  resolveRoom(id: string): Promise<Room>
  hydrateMessage(data: MessageData): Promise<Message>
}

export class ChattoContext implements ClientContext {
  readonly rest: RestClient
  readonly users: UserManager
  readonly rooms: RoomManager
  readonly messages: MessageManager
  readonly threads: ThreadManager
  readonly assets: AssetManager
  readonly account: AccountManager
  readonly viewer: ViewerManager
  readonly permissions: PermissionManager
  readonly roles: RoleManager
  readonly server: ServerManager
  readonly voice: VoiceCallManager
  readonly push: PushNotificationManager
  readonly bots: BotManager
  readonly search: SearchManager
  readonly notifications: NotificationManager
  private readonly userCache: UserCache
  private readonly roomCache: RoomCache

  constructor(rest: RestClient) {
    this.rest = rest
    this.users = new UserManager(this)
    this.rooms = new RoomManager(this)
    this.messages = new MessageManager(this)
    this.threads = new ThreadManager(this)
    this.assets = new AssetManager(this)
    this.account = new AccountManager(this)
    this.viewer = new ViewerManager(this)
    this.permissions = new PermissionManager(this)
    this.roles = new RoleManager(this)
    this.server = new ServerManager(this)
    this.voice = new VoiceCallManager(this)
    this.push = new PushNotificationManager(this)
    this.bots = new BotManager(this)
    this.search = new SearchManager(this)
    this.notifications = new NotificationManager(this)
    this.userCache = new UserCache(id => this.users.fetch(id))
    this.roomCache = new RoomCache(id => this.rooms.fetch(id))
  }

  resolveUser(id: string): Promise<User> {
    return this.userCache.resolve(id)
  }

  resolveRoom(id: string): Promise<Room> {
    return this.roomCache.resolve(id)
  }

  /**
   * Author and channel are resolved through the client's permanent per-client
   * caches (`userCache`/`roomCache`) and are point-in-time snapshots for the
   * lifetime of the client: once cached, they are never re-fetched. Volatile
   * fields on the resolved objects (e.g. `author.presenceStatus`,
   * `author.displayName`, `channel.name`) may go stale if they change
   * upstream. Call `client.users.fetch(id)` / `client.rooms.fetch(id)` for
   * live, uncached data.
   */
  async hydrateMessage(data: MessageData): Promise<Message> {
    const [author, channel] = await Promise.all([
      this.resolveUser(data.actorId).catch(() => User.partial(data.actorId)),
      this.resolveRoom(data.roomId).catch(() => Room.partial(data.roomId, this)),
    ])
    return new Message(data, this, { author, channel })
  }
}
