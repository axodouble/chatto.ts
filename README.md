# chatto.ts

[![npm version](https://img.shields.io/npm/v/chatto.ts?style=flat)](https://www.npmjs.com/package/chatto.ts)
[![npm downloads](https://img.shields.io/npm/dw/chatto.ts?style=flat)](https://www.npmjs.com/package/chatto.ts)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue?style=flat)](LICENSE)
[![Publish to npm](https://img.shields.io/github/actions/workflow/status/axodouble/chatto.ts/.github%2Fworkflows%2Fpublish.yml)](https://github.com/axodouble/chatto.ts)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178c6&logo=typescript&logoColor=white?style=flat)](https://www.typescriptlang.org/)

A Chatto Typescript library to interface with a Chatto instance.
Tested against `v0.4.20` of Chatto.

If you are looking for a `Java` SDK, [feel free to use this SDK made by a fellow developer](https://github.com/freakynit/chatto-java-sdk)!

## API

The API will be built upon the documentation that lives at [docs.chatto.run](https://docs.chatto.run/reference/connectrpc-api/).

The documentation itself is bound to change.

## Usage

You can install this easily as an NPM package, just by using either bun or npm to install it.
Use `bun i chatto.ts` or `npm i chatto.ts`.

### ⚠️ CURRENTLY ONLY PASSWORD AUTHENTICATION WORKS ⚠️

This is because https://github.com/chattocorp/chatto/issues/266 is not yet implemented.
Once that is the case I intend to change it to allow for dedicated bot API tokens using a bot account.

A simple example application:

```typescript
import { ChattoClient } from "chatto.ts";

// Login to the account
const client = await ChattoClient.login({
    baseUrl: "https://chat.example.com",
    login: "<username>",
    password: "<password>"
})

// Listen for a "command"
client.on('messageCreate', async message=>{
    if(message.content?.toLowerCase().startsWith('/ping')){
        const time = Date.now()
        const msg = await message.reply('Ping...')
        await msg.edit(`Pong! API Latency is ${Date.now() - time}ms`)
    }
})

// Connect
client.connect()
```

### Uploading images & media

Attach files directly when sending or replying — they are uploaded to the room
and attached automatically (at most 10 attachments per message):

```typescript
const bytes = await Bun.file("cat.png").bytes() // any Uint8Array / ArrayBuffer

// Attach inline when sending
await client.messages.send(roomId, {
    content: "look at this",
    files: [{ data: bytes, filename: "cat.png", contentType: "image/png" }],
})

// Or reply with a file
client.on('messageCreate', async message => {
    if (message.content === '/cat') {
        await message.reply({ files: [{ data: bytes, filename: "cat.png", contentType: "image/png" }] })
    }
})
```

You can also upload once and reuse the asset id, or read attachments off a
message:

```typescript
const asset = await client.assets.upload(roomId, { data: bytes, filename: "cat.png", contentType: "image/png" })
await client.messages.send(roomId, { content: "reused", attachmentIds: [asset.id] })

client.on('messageCreate', message => {
    for (const attachment of message.attachments) {
        console.log(attachment.filename, attachment.url) // signed URL, may expire
    }
})
```

### Setting your status

Presence is transient — the client refreshes it automatically every 30s while set.

```typescript
// Presence: 'online' | 'away' | 'dnd' | 'offline' (aliases: 'idle', 'invisible')
await client.setStatus('online')

// Appear offline: stops refreshing; the server record expires via TTL.
await client.setStatus('offline')

// Custom status (emoji + text, optional expiry)
await client.setCustomStatus({ emoji: '🎧', text: 'listening', expiresAt: new Date(Date.now() + 3600_000) })
await client.clearCustomStatus()
```

Disable auto-refresh (one-shot presence updates you manage yourself):

```typescript
const client = new ChattoClient({ baseUrl, token, presence: { autoRefresh: false } })
```

### Auto-refresh & reconnect

The client automatically handles token expiration and realtime disconnects. Enable automatic re-login on auth failure by passing credentials:

```typescript
const client = new ChattoClient({
    baseUrl: "https://chat.example.com",
    token: initialToken,
    credentials: { login: "username", password: "password" }
})
```

Alternatively, use `ChattoClient.login()` — it retains credentials automatically:

```typescript
const client = await ChattoClient.login({
    baseUrl: "https://chat.example.com",
    login: "username",
    password: "password"
})
```

**Realtime reconnection:** If the websocket drops (e.g. transient network failure), the client reconnects with exponential backoff + jitter. Configure via `reconnect` options:

```typescript
const client = new ChattoClient({
    baseUrl: "https://chat.example.com",
    token: initialToken,
    credentials: { login: "username", password: "password" },
    reconnect: {
        baseDelayMs: 1000,     // initial delay (default)
        maxDelayMs: 30000,     // cap (default)
        factor: 2,             // exponential multiplier (default)
        maxAttempts: Infinity  // attempts before giving up (default)
    }
})
```

**Token refresh:** Optionally refresh the token on an interval (e.g. to refresh every 5 minutes):

```typescript
const client = new ChattoClient({
    baseUrl: "https://chat.example.com",
    token: initialToken,
    credentials: { login: "username", password: "password" },
    refresh: { intervalMs: 5 * 60 * 1000 } // refresh every 5 minutes
})
```

Listen for `tokenRefresh` (after successful re-login) and `reconnecting` (before each reconnect attempt):

```typescript
client.on('tokenRefresh', () => console.log('Token refreshed'))
client.on('reconnecting', (attempt, delayMs) => {
    console.log(`Reconnecting (attempt ${attempt}) in ${delayMs}ms`)
})
```

## Running the live tests locally

The live integration tests (`tests/integration`) can run against a disposable Chatto `v0.5.0` server in Docker instead of a real instance.
Requires Docker with Compose, `curl` and `jq`.

```bash
bun run test:server:up    # start the server on http://localhost:4000, seed it, write .env.test
bun run test:live         # run tests/integration with .env.test (your .env is left alone)
bun run test:server:down  # stop the server and delete its data
```

The seed script (`docker/seed.sh`) completes first-run setup with an owner account `sdktest` / `chatto-ts-test-password`, creates a `#sdk-tests` channel, and is safe to re-run.
All secrets in `docker/chatto.toml` are throwaway test values; do not reuse them.

I do not own nor claim any ownership of the Chatto name or brand. Chatto and similar branding is all owned by their respective owners.
I do not have any affiliation with Chatto.

- Note, most of this code is AI generated, this is because I am expecting most things to break as Chatto is still in active development. Once a first stable release is announced where breaking changes should not occur anymore I will be going over everything to reimplement and refactor the code.