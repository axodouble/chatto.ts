import { describe, it, expect, mock } from 'bun:test'
import { prepareCreateInput, createMessageBody } from '../../src/builders/create-input'
import { MessageBuilder } from '../../src/builders/message'
import { ChattoValidationError } from '../../src/errors'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const file = { data: new Uint8Array([1]), filename: 'a.png', contentType: 'image/png' }

function makeCtx() {
  let n = 0
  return { assets: { upload: mock(async () => ({ id: `as_up_${++n}` })) } } as any
}

describe('prepareCreateInput', () => {
  it('generates a fresh UUID idempotency key per call', async () => {
    const ctx = makeCtx()
    const builder = new MessageBuilder().setContent('hi')
    const a = await prepareCreateInput(ctx, 'R', builder)
    const b = await prepareCreateInput(ctx, 'R', builder)
    expect(a.idempotencyKey).toMatch(UUID)
    expect(b.idempotencyKey).toMatch(UUID)
    expect(a.idempotencyKey).not.toBe(b.idempotencyKey)
    expect(builder.getIdempotencyKey()).toBeUndefined()
  })

  it('uses an explicit key, and omits it when disabled', async () => {
    const ctx = makeCtx()
    const key = '123e4567-e89b-12d3-a456-426614174000'
    expect((await prepareCreateInput(ctx, 'R', new MessageBuilder().setContent('x').setIdempotencyKey(key))).idempotencyKey)
      .toBe(key)
    expect((await prepareCreateInput(ctx, 'R', new MessageBuilder().setContent('x').setIdempotencyKey(false))).idempotencyKey)
      .toBeUndefined()
  })

  it('rejects a non-UUID idempotency key', async () => {
    await expect(prepareCreateInput(makeCtx(), 'R', new MessageBuilder().setContent('x').setIdempotencyKey('nope')))
      .rejects.toBeInstanceOf(ChattoValidationError)
  })

  it('maps file descriptions onto the uploaded asset ids and trims them', async () => {
    const ctx = makeCtx()
    const input = await prepareCreateInput(
      ctx, 'R',
      new MessageBuilder().addAttachment('as_x', ' explicit ').addFile(file, '  uploaded ').addFile(file),
    )
    expect(input.attachmentAssetIds).toEqual(['as_x', 'as_up_1', 'as_up_2'])
    expect(input.attachmentDescriptions).toEqual([
      { assetId: 'as_x', description: 'explicit' },
      { assetId: 'as_up_1', description: 'uploaded' },
    ])
  })

  it('drops empty descriptions', async () => {
    const input = await prepareCreateInput(makeCtx(), 'R', new MessageBuilder().addAttachment('as_x', '   '))
    expect(input.attachmentDescriptions).toBeUndefined()
  })

  it('rejects an over-long description before uploading', async () => {
    const ctx = makeCtx()
    await expect(prepareCreateInput(ctx, 'R', new MessageBuilder().addFile(file, 'x'.repeat(1001))))
      .rejects.toBeInstanceOf(ChattoValidationError)
    expect(ctx.assets.upload).not.toHaveBeenCalled()
  })

  it('rejects a description for an asset that is not attached', async () => {
    await expect(prepareCreateInput(makeCtx(), 'R', new MessageBuilder().setContent('x').setAttachmentDescription('as_q', 'd')))
      .rejects.toBeInstanceOf(ChattoValidationError)
  })

  it('rejects createThread combined with a thread root', async () => {
    await expect(prepareCreateInput(makeCtx(), 'R', new MessageBuilder().setContent('x').setCreateThread().setThreadRoot('E')))
      .rejects.toBeInstanceOf(ChattoValidationError)
  })
})

describe('createMessageBody', () => {
  it('maps every CreateMessage field', () => {
    const input = {
      roomId: 'R', body: 'b', attachmentAssetIds: ['a'], attachmentDescriptions: [{ assetId: 'a', description: 'd' }],
      inReplyTo: 'i', threadRootEventId: 't', alsoSendToChannel: true, createThread: false,
      linkPreviewToken: 'l', idempotencyKey: 'k',
    }
    expect(createMessageBody(input)).toEqual(input)
  })
})
