import { describe, it, expect } from 'bun:test'
import { ChattoClient } from '../../src/index'
import type { Message, ReactionEvent, RealtimeCaughtUp } from '../../src/index'

// Chatto 0.5 features against a real server. Run against the disposable
// Docker server (`bun run test:server:up && bun run test:live`): the bot test
// creates and deletes a bot account and needs an owner/admin login.
const baseUrl = process.env.CHATTO_BASE_URL
const login = process.env.CHATTO_LOGIN
const password = process.env.CHATTO_PASSWORD
const testRoom = process.env.CHATTO_TEST_ROOM
const hasRoom = Boolean(baseUrl && login && password && testRoom)

const signIn = (extra: Partial<Parameters<typeof ChattoClient.login>[0]> = {}) =>
  ChattoClient.login({ baseUrl: baseUrl!, login: login!, password: password!, ...extra })

/** Resolve with the first `event` payload matching `predicate`, or reject after `timeoutMs`. */
function waitFor<T>(client: ChattoClient, event: string, predicate: (payload: T) => boolean, timeoutMs = 15000): Promise<T> {
  const emitter = client as unknown as {
    on(e: string, h: (p: T) => void): void
    off(e: string, h: (p: T) => void): void
  }
  return new Promise((resolve, reject) => {
    const handler = (payload: T) => {
      if (!predicate(payload)) return
      clearTimeout(timer)
      emitter.off(event, handler)
      resolve(payload)
    }
    const timer = setTimeout(() => {
      emitter.off(event, handler)
      reject(new Error(`timed out waiting for '${event}'`))
    }, timeoutMs)
    emitter.on(event, handler)
  })
}

describe.if(hasRoom)('live Chatto 0.5 features', () => {
  it('resumes the realtime stream after a dropped socket without losing events', async () => {
    const client = await signIn({ reconnect: { baseDelayMs: 1500, maxDelayMs: 1500 }, presence: { autoRefresh: false } })
    const errors: Error[] = []
    client.on('error', e => errors.push(e))
    await client.connect()
    try {
      const resumed = waitFor<RealtimeCaughtUp>(client, 'caughtUp', () => true)
      const marker = `missed while offline ${Date.now()}`
      const created = waitFor<Message>(client, 'messageCreate', m => m.content === marker)

      // Drop the socket abruptly, then post while the client is reconnecting.
      ;((client as any).realtime.ws as { terminate(): void }).terminate()
      await client.messages.send(testRoom!, marker)

      expect((await resumed).recovery).toBe('REALTIME_RECOVERY_RESUMED')
      const message = await created
      expect(message.channel.id).toBe(testRoom!)
      expect(errors.filter(e => !/socket|closed/i.test(e.message))).toEqual([])
      await message.delete()
    } finally {
      await client.disconnect()
    }
  }, 30000)

  it('emits typed realtime events and accepts Unicode reactions', async () => {
    const client = await signIn({ presence: { autoRefresh: false } })
    await client.connect()
    try {
      const marker = `typed events ${Date.now()}`
      const posted = waitFor<[any, any]>(client, 'raw', (e: any) => e.event === 'messagePosted' && e.messagePosted.bodyPlaintext === marker)
      const sent = await client.messages.send(testRoom!, marker)
      const raw = (await posted) as any
      expect(raw.id).toBe(sent.id)
      expect(raw.messagePosted.roomKind).toBe('ROOM_KIND_CHANNEL')

      const reacted = waitFor<ReactionEvent>(client, 'reactionAdd', e => e.messageEventId === sent.id)
      const result = await sent.react('👍')
      expect(result.added).toBe(true)
      expect((await reacted).emoji).toBe('thumbsup')

      const users = await sent.fetchReactionUsers('thumbsup')
      expect(users.items.length).toBe(1)
      await sent.delete()
    } finally {
      await client.disconnect()
    }
  }, 30000)

  it('renews the session with the rotating refresh token', async () => {
    const client = await signIn({ retainCredentials: false })
    const before = client.session
    expect(before.refreshToken).toBeString()
    const refreshed = new Promise(resolve => client.once('tokenRefresh', resolve))
    await client.refreshToken()
    await refreshed
    expect(client.session.token).not.toBe(before.token)
    expect(client.session.refreshToken).not.toBe(before.refreshToken)
    // The renewed token works.
    expect((await client.server.fetchProfile()).version).toBeString()
  })

  it('reads the viewer, server, room directory and notifications', async () => {
    const client = await signIn()
    const viewer = await client.viewer.fetch()
    expect(viewer.user.profile?.login.toLowerCase()).toBe(login!.toLowerCase())
    expect(await client.server.fetchRuntimeConfig()).toBeDefined()

    const page = await client.rooms.listPage({ limit: 1 })
    expect(page.items.length).toBeLessThanOrEqual(1)
    const room = await client.rooms.fetch(testRoom!)
    expect(room.isMember).toBe(true)
    expect(room.isChannel).toBe(true)
    const timeline = await room.fetchEvents({ limit: 5 })
    expect(Array.isArray(timeline.events)).toBe(true)
    await room.sendTyping()

    const notifications = await client.notifications.list({ limit: 5 })
    expect(notifications.unreadCount).toBeGreaterThanOrEqual(0)
    expect(['MESSAGE_SEARCH_STATE_DISABLED', 'MESSAGE_SEARCH_STATE_READY']).toContain((await client.search.status()).state)
  }, 20000)

  it('follows, reads and lists participants of a thread', async () => {
    const client = await signIn()
    const root = await client.messages.send(testRoom!, { content: `thread ${Date.now()}`, createThread: true })
    const reply = await root.reply('reply in thread')
    expect(reply.threadRootEventId).toBe(root.id)

    const participants = await client.threads.fetchParticipants(testRoom!, root.id)
    expect(participants.items.length).toBeGreaterThanOrEqual(1)
    expect((await root.follow()).following).toBe(true)
    await root.markThreadRead()
    const state = await client.threads.fetchReadState(testRoom!, root.id)
    expect(state).toBeDefined()
    expect((await root.unfollow()).following).toBe(false)
  }, 20000)

  it('creates a bot that connects with its API key and receives a DM', async () => {
    const owner = await signIn({ presence: { autoRefresh: false } })
    await owner.viewer.activatePrivilegedMode()
    const suffix = Date.now().toString(36)
    const issued = await owner.bots.create({ login: `sdkbot${suffix}`, displayName: 'SDK test bot' })
    const botId = issued.bot.user!.id
    const bot = new ChattoClient({ baseUrl: baseUrl!, token: issued.apiKey })
    try {
      expect(issued.apiKey).toStartWith('cht_BK_')
      // New bots have no permissions: allow reading and posting in DMs.
      await owner.admin.permissions.setUserPermission(botId, ['message.read', 'message.post'], 'allow', 'dm')
      await bot.connect()
      const dm = await owner.rooms.startDM(botId)
      const marker = `hello bot ${suffix}`
      const received = waitFor<Message>(bot, 'messageCreate', m => m.content === marker)
      await dm.send(marker)
      const message = await received
      expect(message.channel.isDM).toBe(true)
      await message.reply('hello human')
    } finally {
      await bot.disconnect()
      await owner.bots.delete(botId)
      await owner.viewer.deactivatePrivilegedMode()
    }
  }, 30000)
})
