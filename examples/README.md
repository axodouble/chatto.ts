# chatto.ts examples

Runnable bots that use a Chatto bot account. In this repo, `chatto.ts` resolves to `../src`
(see `tsconfig.json` here); in your own project, `bun i chatto.ts` and the imports work unchanged.

## Setup

1. In Chatto, go to **Server Admin → Bots → Create Bot** and copy the API key (`cht_BK_…`).
   It is shown only once.
2. Add the bot to the rooms it should work in and allow it `message.read`, `message.post`,
   `message.react` and `message.attach` there (the bot's **Permissions** page, or
   `client.admin.permissions.setUserPermission(botId, [...], 'allow', { roomId })`).
3. Run an example:

```sh
export CHATTO_BASE_URL=https://chat.example.com
export CHATTO_BOT_TOKEN=cht_BK_...

bun examples/ping-bot.ts            # replies to /ping
bun examples/command-bot/main.ts    # !help lists the commands
```

## command-bot

| File | Purpose |
| --- | --- |
| `main.ts` | Entry point: reads env, connects, logs reconnects/errors, shuts down on SIGINT/SIGTERM. |
| `bot.ts` | `createCommandBot(client, options)`: prefix parsing, routing, self-ignore, error handling. |
| `commands.ts` | The commands. Add your own by appending to `defaultCommands` or passing `commands`. |

Commands (default prefix `!`, override with `CHATTO_PREFIX`):

| Command | Shows |
| --- | --- |
| `!help` | Listing registered commands |
| `!ping` | `reply()` then `edit()` |
| `!echo <text>` | Input validation with a usage message |
| `!roll [NdM]` | Argument parsing |
| `!react [emoji]` | `react()` with Unicode (`🎉`) or shortcodes (`:rocket:`) |
| `!cat` | Uploading an image with `files` |
| `!thread` | Thread replies and `threads.fetchHistory()` |
| `!whoami` | `message.author`, `isBot` |
| `!uptime` | A plain reply |

Throw `UsageError` from a command to reply with your message and the command's usage. Any other error
is passed to `onError` and the user gets a generic "Something went wrong" reply; the bot keeps running.

## Testing

`bun test` runs `tests/examples/command-bot.test.ts`, which drives the real `ChattoClient` and this bot
against an in-memory fake Chatto server (bearer auth, realtime events, chunked uploads, threads,
reaction names, idempotency keys, failures, key revocation).

`tests/integration/examples.live.test.ts` runs the same bot against a real server, with a second bot
sending the commands. The easiest way is the disposable Docker server, which creates both bots:

```sh
bun run test:server:up && bun run test:live
```

Against your own server, put these in `.env`:

```sh
CHATTO_BASE_URL=https://chat.example.com
CHATTO_BOT_TOKEN=cht_BK_...      # runs the example bot
CHATTO_DRIVER_TOKEN=cht_BK_...   # a second bot that sends commands
CHATTO_TEST_ROOM=<room id>       # both bots must be able to read and post here
```
