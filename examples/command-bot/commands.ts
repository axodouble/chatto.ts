import { ChattoApiError, type ChattoClient, type Message, type UserData } from 'chatto.ts'

export interface CommandContext {
  client: ChattoClient
  /** The message that invoked the command. */
  message: Message
  /** Whitespace-split arguments after the command name. */
  args: string[]
  /** Everything after the command name, untouched. */
  rest: string
  /** The bot's own user. */
  self: UserData
  /** Every registered command, for `help`. */
  commands: ReadonlyMap<string, Command>
  /** Command prefix in use, e.g. `!`. */
  prefix: string
}

export interface Command {
  name: string
  description: string
  usage?: string
  run(ctx: CommandContext): Promise<unknown>
}

/** Thrown for bad user input; the bot replies with the message instead of a generic error. */
export class UsageError extends Error {
  override name = 'UsageError'
}

const startedAt = Date.now()
const MAX_ECHO = 2000

export const ping: Command = {
  name: 'ping',
  description: 'Replies with the API round-trip latency.',
  async run({ message }) {
    const started = Date.now()
    const reply = await message.reply('Ping...')
    return reply.edit(`Pong! API latency is ${Date.now() - started}ms`)
  },
}

export const echo: Command = {
  name: 'echo',
  description: 'Repeats your text back.',
  usage: '<text>',
  async run({ message, rest }) {
    const text = rest.trim()
    if (text === '') throw new UsageError('Nothing to echo.')
    if (text.length > MAX_ECHO) throw new UsageError(`Text is too long (max ${MAX_ECHO} characters).`)
    return message.reply(text)
  },
}

/** Parses dice notation like `d6`, `2d20`. Returns null if invalid or out of range. */
export function parseDice(spec: string): { count: number; sides: number } | null {
  const match = /^(\d{0,2})d(\d{1,4})$/i.exec(spec.trim())
  if (match == null) return null
  const count = match[1] === '' ? 1 : Number(match[1])
  const sides = Number(match[2])
  if (count < 1 || count > 20 || sides < 2 || sides > 1000) return null
  return { count, sides }
}

export const roll: Command = {
  name: 'roll',
  description: 'Rolls dice. Up to 20 dice with 2-1000 sides.',
  usage: '[NdM, default 1d6]',
  async run({ message, args }) {
    const dice = parseDice(args[0] ?? '1d6')
    if (dice == null) throw new UsageError('Use dice notation like `d6` or `2d20` (1-20 dice, 2-1000 sides).')
    const rolls = Array.from({ length: dice.count }, () => 1 + Math.floor(Math.random() * dice.sides))
    const total = rolls.reduce((a, b) => a + b, 0)
    const detail = rolls.length > 1 ? ` (${rolls.join(' + ')})` : ''
    return message.reply(`🎲 ${dice.count}d${dice.sides}: **${total}**${detail}`)
  },
}

export const react: Command = {
  name: 'react',
  description: 'Reacts to your message with an emoji or shortcode.',
  usage: '[emoji or shortcode, default 👍]',
  async run({ message, args }) {
    // Unicode emoji ("👍") are mapped to Chatto reaction names; ":tada:" becomes "tada".
    const emoji = args[0] ?? '👍'
    try {
      return await message.react(emoji)
    } catch (err) {
      if (err instanceof ChattoApiError && err.code === 'invalid_argument') throw new UsageError(`Unknown emoji \`${emoji}\`.`)
      throw err
    }
  },
}

export const cat: Command = {
  name: 'cat',
  description: 'Uploads a picture.',
  async run({ message }) {
    const data = await Bun.file(new URL('./assets/cat.png', import.meta.url)).bytes()
    return message.reply({ content: 'Here you go:', files: [{ data, filename: 'cat.png', contentType: 'image/png' }] })
  },
}

export const thread: Command = {
  name: 'thread',
  description: 'Replies twice in a thread, then reports how many thread messages exist.',
  async run({ client, message }) {
    const first = await message.reply('Thread reply 1')
    await first.reply('Thread reply 2')
    const history = await client.threads.fetchHistory(message.channelId, message.threadRootId)
    const replies = history.filter(m => m.isThreadReply).length
    return message.reply(`This thread has ${replies} replies.`)
  },
}

export const whoami: Command = {
  name: 'whoami',
  description: 'Shows who sent the command.',
  async run({ message }) {
    const a = message.author
    return message.reply(`You are ${a.displayName} (@${a.login}, ${a.id})${a.isBot ? ', a bot' : ''}.`)
  },
}

export const uptime: Command = {
  name: 'uptime',
  description: 'Shows how long the bot has been running.',
  async run({ message }) {
    const s = Math.floor((Date.now() - startedAt) / 1000)
    return message.reply(`Up for ${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ${s % 60}s.`)
  },
}

export const help: Command = {
  name: 'help',
  description: 'Lists commands.',
  async run({ message, commands, prefix }) {
    const lines = [...commands.values()].map(c => `- \`${prefix}${c.name}${c.usage ? ` ${c.usage}` : ''}\` ${c.description}`)
    return message.reply(['Commands:', ...lines].join('\n'))
  },
}

export const defaultCommands: Command[] = [help, ping, echo, roll, react, cat, thread, whoami, uptime]
