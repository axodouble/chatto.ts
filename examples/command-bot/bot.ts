import type { ChattoClient, Message, UserData } from 'chatto.ts'
import { defaultCommands, UsageError, type Command } from './commands'

export interface CommandBotOptions {
  /** Prefix that marks a command. Default `!`. */
  prefix?: string
  commands?: Command[]
  /** Ignore commands sent by other bots (the bot always ignores itself). Default false. */
  ignoreBots?: boolean
  /** Called when a command throws something other than a UsageError. */
  onError?: (err: Error, message: Message) => void
}

export interface CommandBot {
  readonly self: UserData
  readonly commands: ReadonlyMap<string, Command>
  /** Runs a single message through the router. Resolves once its command finishes. */
  handle(message: Message): Promise<void>
  /** Stops listening and waits for commands already running. */
  stop(): Promise<void>
}

/**
 * Wires a prefix command router onto a client. The client does not have to be
 * connected yet; call `client.connect()` afterwards to start receiving messages.
 */
export async function createCommandBot(client: ChattoClient, options: CommandBotOptions = {}): Promise<CommandBot> {
  const prefix = options.prefix ?? '!'
  const commands = new Map<string, Command>()
  for (const cmd of options.commands ?? defaultCommands) commands.set(cmd.name.toLowerCase(), cmd)

  const self = (await client.viewer.fetch()).user.profile
  if (self == null) throw new Error('GetViewer returned no profile for this token')
  const inFlight = new Set<Promise<void>>()

  const handle = async (message: Message): Promise<void> => {
    if (message.actorId === self.id) return
    if (options.ignoreBots && message.author.isBot) return
    const content = message.content?.trim()
    if (content == null || !content.startsWith(prefix)) return

    const body = content.slice(prefix.length)
    const name = /^\S*/.exec(body)![0].toLowerCase()
    if (name === '') return
    const rest = body.slice(name.length).replace(/^\s+/, '')
    const args = rest === '' ? [] : rest.split(/\s+/)

    const command = commands.get(name)
    try {
      if (command == null) {
        await message.reply(`Unknown command \`${prefix}${name}\`. Try \`${prefix}help\`.`)
        return
      }
      await command.run({ client, message, args, rest, self, commands, prefix })
    } catch (err) {
      if (err instanceof UsageError) {
        const usage = command?.usage ? ` Usage: \`${prefix}${command.name} ${command.usage}\`` : ''
        await message.reply(`${err.message}${usage}`).catch(() => {})
        return
      }
      const error = err instanceof Error ? err : new Error(String(err))
      options.onError?.(error, message)
      await message.reply(`Something went wrong running \`${prefix}${name}\`.`).catch(() => {})
    }
  }

  const listener = (message: Message) => {
    const p = handle(message).finally(() => inFlight.delete(p))
    inFlight.add(p)
  }
  client.on('messageCreate', listener)

  return {
    self,
    commands,
    handle,
    async stop() {
      client.off('messageCreate', listener)
      await Promise.allSettled([...inFlight])
    },
  }
}
