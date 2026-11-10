import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { ChattoClient } from '../../src/index'
import type { Message, Room } from '../../src/index'
import { createCommandBot, type CommandBot } from '../../examples/command-bot/bot'

/**
 * Runs the example command bot against a real Chatto server and drives it from
 * a second bot account, so the examples double as an end-to-end test.
 *
 * `bun run test:server:up` provisions all of this on a local Docker server.
 * Otherwise it needs, in .env:
 *   CHATTO_BASE_URL     server URL
 *   CHATTO_BOT_TOKEN    key of the bot that runs the example
 *   CHATTO_DRIVER_TOKEN key of a second bot that sends the commands
 *   CHATTO_TEST_ROOM    room id both bots can read and post in
 */
const baseUrl = process.env.CHATTO_BASE_URL
const botToken = process.env.CHATTO_BOT_TOKEN
const driverToken = process.env.CHATTO_DRIVER_TOKEN
const testRoom = process.env.CHATTO_TEST_ROOM
const enabled = Boolean(baseUrl && botToken && driverToken && testRoom)

if (!enabled) {
  // eslint-disable-next-line no-console
  console.log('[live:examples] skipping — set CHATTO_BASE_URL, CHATTO_BOT_TOKEN, CHATTO_DRIVER_TOKEN and CHATTO_TEST_ROOM to run')
}

describe.if(enabled)('live: examples/command-bot', () => {
  let botClient: ChattoClient
  let driver: ChattoClient
  let bot: CommandBot
  let room: Room
  const errors: Error[] = []
  // Unique prefix per run so stray bots or earlier runs can't answer for us.
  const prefix = `!t${Date.now().toString(36)}.`

  beforeAll(async () => {
    botClient = new ChattoClient({ baseUrl: baseUrl!, token: botToken! })
    driver = new ChattoClient({ baseUrl: baseUrl!, token: driverToken! })
    botClient.on('error', e => errors.push(e))
    bot = await createCommandBot(botClient, { prefix, onError: e => errors.push(e) })
    await botClient.connect()
    room = await driver.rooms.fetch(testRoom!)
  }, 20000)

  afterAll(async () => {
    await bot?.stop()
    await botClient?.disconnect()
    await driver?.disconnect()
  })

  /** Sends a command as the driver and polls the thread until `count` bot replies exist. */
  async function command(text: string, count = 1, timeoutMs = 15000): Promise<{ sent: Message; replies: Message[] }> {
    const sent = await room.send(`${prefix}${text}`)
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const history = await driver.threads.fetchHistory(testRoom!, sent.id)
      const replies = history.filter(m => m.actorId === bot.self.id && m.isThreadReply)
      if (replies.length >= count) return { sent, replies }
      if (Date.now() > deadline) throw new Error(`no reply to '${text}' within ${timeoutMs}ms (got ${replies.length})`)
      await Bun.sleep(500)
    }
  }

  it('runs as a bot identity distinct from the driver', async () => {
    const driverSelf = (await driver.viewer.fetch()).user.profile!
    expect(bot.self.bot).toBeDefined()
    expect(driverSelf.bot).toBeDefined()
    expect(driverSelf.id).not.toBe(bot.self.id)
  })

  it('ping: replies, then edits with the latency', async () => {
    const { replies } = await command('ping')
    let body = replies[0]!.content
    for (let i = 0; i < 10 && !body?.startsWith('Pong!'); i++) {
      await Bun.sleep(300)
      body = (await driver.messages.fetch(testRoom!, replies[0]!.id)).content
    }
    expect(body).toMatch(/^Pong! API latency is \d+ms$/)
  }, 20000)

  it('echo and usage errors', async () => {
    expect((await command('echo live echo ✅')).replies[0]!.content).toBe('live echo ✅')
    expect((await command('echo')).replies[0]!.content).toStartWith('Nothing to echo.')
  }, 30000)

  it('roll', async () => {
    expect((await command('roll 2d6')).replies[0]!.content).toMatch(/^🎲 2d6: \*\*\d+\*\*/)
  }, 20000)

  it('react: Unicode and shortcode reactions, and unknown emoji', async () => {
    for (const [input, name] of [['🎉', 'tada'], [':rocket:', 'rocket']] as const) {
      const sent = await room.send(`${prefix}react ${input}`)
      let reactions: string[] = []
      for (let i = 0; i < 30 && !reactions.includes(name); i++) {
        await Bun.sleep(300)
        reactions = (await sent.fetch()).reactions.map(r => r.emoji)
      }
      expect(reactions).toContain(name)
    }
    expect((await command('react not-an-emoji-xyz')).replies[0]!.content).toStartWith('Unknown emoji')
  }, 40000)

  it('thread: replies in the thread and reads it back', async () => {
    const { replies } = await command('thread', 3)
    expect(replies.map(r => r.content)).toEqual(['Thread reply 1', 'Thread reply 2', 'This thread has 2 replies.'])
  }, 30000)

  it('cat: uploads and attaches an image', async () => {
    const { replies } = await command('cat', 1, 30000)
    expect(replies[0]!.attachments).toHaveLength(1)
    expect(replies[0]!.attachments[0]!.isImage).toBe(true)
  }, 40000)

  it('whoami: sees the driver as a bot', async () => {
    const driverSelf = (await driver.viewer.fetch()).user.profile!
    expect((await command('whoami')).replies[0]!.content).toBe(
      `You are ${driverSelf.displayName} (@${driverSelf.login}, ${driverSelf.id}), a bot.`)
  }, 20000)

  it('unknown command', async () => {
    expect((await command('definitely-not-a-command')).replies[0]!.content).toStartWith('Unknown command')
  }, 20000)

  it('no unexpected errors were reported', () => {
    expect(errors).toEqual([])
  })
})
