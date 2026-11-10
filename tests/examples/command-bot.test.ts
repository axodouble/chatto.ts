import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { FakeChatto } from './fake-chatto'
import { createCommandBot, type CommandBot } from '../../examples/command-bot/bot'
import { parseDice } from '../../examples/command-bot/commands'
import type { ChattoClient } from '../../src/client'
import { ChattoAuthError } from '../../src/errors'

const BOT_TOKEN = 'cht_BK_bot'
const OTHER_BOT_TOKEN = 'cht_BK_other'

describe('examples/command-bot (offline, against a fake Chatto)', () => {
  let server: FakeChatto
  let client: ChattoClient
  let bot: CommandBot
  let errors: Error[]

  beforeEach(async () => {
    server = new FakeChatto().install()
    server.addUser({ id: 'U_bot', login: 'commandbot', displayName: 'Command Bot', bot: { ownerUserId: 'U_alice' } }, BOT_TOKEN)
    server.addUser({ id: 'U_alice', login: 'alice', displayName: 'Alice' })
    server.addUser({ id: 'U_other', login: 'otherbot', displayName: 'Other Bot', bot: {} }, OTHER_BOT_TOKEN)
    client = server.client(BOT_TOKEN)
    errors = []
    client.on('error', e => errors.push(e))
    bot = await createCommandBot(client, { onError: e => errors.push(e) })
    await client.connect()
  })

  afterEach(async () => {
    await bot.stop()
    await client.disconnect()
    server.uninstall()
  })

  /** Alice sends `text`; resolves with the bot's replies once `count` have arrived. */
  async function command(text: string, count = 1, from = 'U_alice') {
    const msg = server.post(from, text)
    const replies = await server.waitFor(() => {
      const r = server.repliesTo(msg.id)
      return r.length >= count ? r : null
    })
    return { msg, replies }
  }

  it('identifies itself as a bot via GetViewer', () => {
    expect(bot.self.id).toBe('U_bot')
    expect(bot.self.bot?.ownerUserId).toBe('U_alice')
  })

  it('does not trigger the password-auth deprecation path', () => {
    expect(server.calls.some(c => c.method === 'login')).toBe(false)
    expect(client.session.refreshToken).toBeUndefined()
  })

  it('authenticates every request with the bot key as a bearer token', async () => {
    await command('!ping')
    expect(server.calls.length).toBeGreaterThan(0)
    expect(server.calls.every(c => c.userId === 'U_bot')).toBe(true)
  })

  it('!ping replies, then edits the reply with the latency', async () => {
    const { replies } = await command('!ping')
    await server.waitFor(() => replies[0]!.updatedAt)
    expect(replies[0]!.body).toMatch(/^Pong! API latency is \d+ms$/)
    expect(replies[0]!.actorId).toBe('U_bot')
  })

  it('!echo repeats text and rejects empty input with usage', async () => {
    expect((await command('!echo   hello   world ')).replies[0]!.body).toBe('hello   world')
    expect((await command('!echo')).replies[0]!.body).toBe('Nothing to echo. Usage: `!echo <text>`')
  })

  it('!roll rolls within range and rejects bad notation', async () => {
    const { replies } = await command('!roll 3d6')
    const total = Number(/\*\*(\d+)\*\*/.exec(replies[0]!.body!)![1])
    expect(total).toBeGreaterThanOrEqual(3)
    expect(total).toBeLessThanOrEqual(18)
    expect((await command('!roll 99d6')).replies[0]!.body).toStartWith('Use dice notation')
  })

  it('parseDice validates bounds', () => {
    expect(parseDice('d20')).toEqual({ count: 1, sides: 20 })
    expect(parseDice('20d1000')).toEqual({ count: 20, sides: 1000 })
    for (const bad of ['0d6', '21d6', 'd1', 'd1001', '2x6', '', 'd']) expect(parseDice(bad)).toBeNull()
  })

  it('!react maps Unicode and :shortcode: input to reaction names', async () => {
    for (const [input, name] of [['🎉', 'tada'], [':rocket:', 'rocket'], ['', 'thumbsup']] as const) {
      const msg = server.post('U_alice', `!react ${input}`.trim())
      const reaction = await server.waitFor(() => server.reactions.find(r => r.messageEventId === msg.id))
      expect(reaction).toEqual({ messageEventId: msg.id, emoji: name, actorId: 'U_bot' })
    }
  })

  it('!react turns a server INVALID_ARGUMENT into a usage reply', async () => {
    expect((await command('!react not-an-emoji')).replies[0]!.body).toBe(
      'Unknown emoji `not-an-emoji`. Usage: `!react [emoji or shortcode, default 👍]`')
  })

  it('!cat uploads the image in chunks and attaches it', async () => {
    const { replies } = await command('!cat')
    expect(replies[0]!.attachments).toHaveLength(1)
    expect(replies[0]!.attachments[0]).toMatchObject({ filename: 'cat.png', contentType: 'image/png' })
    const chunks = server.calls.filter(c => c.method === 'UploadChunk')
    expect(chunks.length).toBeGreaterThan(1) // 256x256 PNG > one 4 KiB chunk
  })

  it('!thread replies inside the thread and reads its history back', async () => {
    const msg = server.post('U_alice', '!thread')
    const summary = await server.waitFor(() =>
      [...server.messages.values()].find(m => m.body?.startsWith('This thread has')))
    expect(summary.body).toBe('This thread has 2 replies.')
    const inThread = [...server.messages.values()].filter(m => m.threadRootEventId === msg.id)
    expect(inThread.map(m => m.body)).toEqual(['Thread reply 1', 'Thread reply 2', 'This thread has 2 replies.'])
    // Every reply is rooted at the command message, even the reply-to-a-reply.
    expect(inThread.every(m => m.threadRootEventId === msg.id)).toBe(true)
  })

  it('!whoami reports the author, including other bots', async () => {
    expect((await command('!whoami')).replies[0]!.body).toBe('You are Alice (@alice, U_alice).')
    expect((await command('!whoami', 1, 'U_other')).replies[0]!.body).toBe('You are Other Bot (@otherbot, U_other), a bot.')
  })

  it('!help lists every command', async () => {
    const body = (await command('!HELP')).replies[0]!.body!
    for (const name of bot.commands.keys()) expect(body).toContain(`\`!${name}`)
  })

  it('answers unknown commands and ignores non-commands', async () => {
    expect((await command('!nope')).replies[0]!.body).toBe('Unknown command `!nope`. Try `!help`.')
    const plain = server.post('U_alice', 'just chatting')
    const bare = server.post('U_alice', '!')
    await command('!ping') // a later command has been answered, so the earlier ones were processed
    expect(server.repliesTo(plain.id)).toHaveLength(0)
    expect(server.repliesTo(bare.id)).toHaveLength(0)
  })

  it('never responds to its own messages', async () => {
    const own = server.post('U_bot', '!ping')
    await command('!ping')
    expect(server.repliesTo(own.id)).toHaveLength(0)
  })

  it('reports a failing command, replies with a generic error, and keeps running', async () => {
    server.failNext.add('AddReaction')
    expect((await command('!react')).replies[0]!.body).toBe('Something went wrong running `!react`.')
    expect(errors.some(e => e.message === 'AddReaction failed')).toBe(true)
    expect((await command('!echo still alive')).replies[0]!.body).toBe('still alive')
  })

  it('sends every reply with an idempotency key', async () => {
    await command('!echo once')
    const creates = server.calls.filter(c => c.method === 'CreateMessage')
    expect(creates.length).toBeGreaterThan(0)
    expect(creates.every(c => typeof c.body['idempotencyKey'] === 'string')).toBe(true)
  })

  it('handles a burst of concurrent commands', async () => {
    const sent = Array.from({ length: 25 }, (_, i) => server.post('U_alice', `!echo ${i}`))
    await server.waitFor(() => sent.every(m => server.repliesTo(m.id).length === 1))
    sent.forEach((m, i) => expect(server.repliesTo(m.id)[0]!.body).toBe(String(i)))
  })

  it('stop() detaches the listener', async () => {
    await bot.stop()
    const msg = server.post('U_alice', '!ping')
    await new Promise(r => setTimeout(r, 50))
    expect(server.repliesTo(msg.id)).toHaveLength(0)
  })

  it('surfaces a revoked key as an auth error and disconnects', async () => {
    const disconnected = new Promise<void>(resolve => client.once('disconnect', () => resolve()))
    server.revoke(BOT_TOKEN)
    await disconnected
    const authError = errors.find(e => e instanceof ChattoAuthError)
    expect(authError?.message).toBe('Realtime auth failed: the token is invalid or was revoked')
  })

  it('ignoreBots skips commands from other bots', async () => {
    await bot.stop()
    bot = await createCommandBot(client, { ignoreBots: true })
    const fromBot = server.post('U_other', '!ping')
    await command('!ping')
    expect(server.repliesTo(fromBot.id)).toHaveLength(0)
  })
})
