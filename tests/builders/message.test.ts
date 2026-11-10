import { describe, it, expect } from 'bun:test'
import { MessageBuilder } from '../../src/builders/message'
import { ChattoValidationError } from '../../src/errors'

describe('MessageBuilder', () => {
  describe('buildCreate', () => {
    it('builds create input with content', () => {
      const input = new MessageBuilder().setContent('Hello!').buildCreate('room_1')
      expect(input.roomId).toBe('room_1')
      expect(input.body).toBe('Hello!')
    })

    it('builds create input with all optional fields', () => {
      const input = new MessageBuilder()
        .setContent('Reply')
        .setReplyTo('evt_parent')
        .setThreadRoot('evt_root')
        .setAlsoSendToChannel(true)
        .buildCreate('room_1')
      expect(input.inReplyTo).toBe('evt_parent')
      expect(input.threadRootEventId).toBe('evt_root')
      expect(input.alsoSendToChannel).toBe(true)
    })

    it('is chainable — returns this', () => {
      const builder = new MessageBuilder()
      expect(builder.setContent('Hi')).toBe(builder)
      expect(builder.setReplyTo('evt_1')).toBe(builder)
      expect(builder.setThreadRoot('evt_2')).toBe(builder)
      expect(builder.setAlsoSendToChannel(false)).toBe(builder)
    })
  })

  describe('attachments', () => {
    const file = { data: new Uint8Array([1, 2, 3]), filename: 'a.png', contentType: 'image/png' }

    it('collects pending files via addFile/addFiles', () => {
      const builder = new MessageBuilder().addFile(file).addFiles(file, file)
      expect(builder.getFiles()).toHaveLength(3)
    })

    it('collects explicit attachment asset ids via addAttachment', () => {
      const builder = new MessageBuilder().addAttachment('as_1').addAttachment('as_2')
      expect(builder.getAttachmentIds()).toEqual(['as_1', 'as_2'])
    })

    it('addFile/addAttachment are chainable', () => {
      const builder = new MessageBuilder()
      expect(builder.addFile(file)).toBe(builder)
      expect(builder.addAttachment('as_1')).toBe(builder)
    })

    it('buildCreate emits attachmentAssetIds from explicit ids', () => {
      const input = new MessageBuilder().setContent('hi').addAttachment('as_1').buildCreate('room_1')
      expect(input.attachmentAssetIds).toEqual(['as_1'])
    })

    it('clone copies pending files and attachment ids', () => {
      const original = new MessageBuilder().addFile(file).addAttachment('as_1')
      const copy = original.clone()
      copy.addAttachment('as_2')
      expect(original.getAttachmentIds()).toEqual(['as_1'])
      expect(copy.getAttachmentIds()).toEqual(['as_1', 'as_2'])
      expect(copy.getFiles()).toHaveLength(1)
    })

    it('builds create input with no content when only files are present', () => {
      const input = new MessageBuilder().addFile(file).buildCreate('room_1')
      expect(input.body).toBeUndefined()
    })
  })

  describe('buildUpdate', () => {
    it('builds update input with roomId and eventId', () => {
      const input = new MessageBuilder().setContent('Updated').buildUpdate('room_1', 'evt_1')
      expect(input.roomId).toBe('room_1')
      expect(input.eventId).toBe('evt_1')
      expect(input.body).toBe('Updated')
    })

    it('sends only the changed fields and names them in updateMask', () => {
      expect(new MessageBuilder().setContent('x').buildUpdate('r', 'e')).toEqual({
        roomId: 'r', eventId: 'e', body: 'x', updateMask: 'body',
      })
      expect(new MessageBuilder().setAlsoSendToChannel(false).buildUpdate('r', 'e')).toEqual({
        roomId: 'r', eventId: 'e', alsoSendToChannel: false, updateMask: 'alsoSendToChannel',
      })
      expect(new MessageBuilder().setContent('x').setAlsoSendToChannel(true).buildUpdate('r', 'e').updateMask)
        .toBe('body,alsoSendToChannel')
    })

    it('throws when nothing was set', () => {
      expect(() => new MessageBuilder().buildUpdate('room_1', 'evt_1')).toThrow(ChattoValidationError)
    })
  })

  describe('v0.5 create fields', () => {
    it('emits createThread, linkPreviewToken, explicit idempotencyKey and descriptions', () => {
      const key = '123e4567-e89b-12d3-a456-426614174000'
      const input = new MessageBuilder()
        .setContent('hi')
        .setCreateThread()
        .setLinkPreviewToken('cht_tok')
        .setIdempotencyKey(key)
        .addAttachment('as_1', 'a cat')
        .addAttachment('as_2')
        .buildCreate('room_1')
      expect(input).toMatchObject({
        createThread: true,
        linkPreviewToken: 'cht_tok',
        idempotencyKey: key,
        attachmentDescriptions: [{ assetId: 'as_1', description: 'a cat' }],
      })
    })

    it('does not generate an idempotency key itself and omits unset fields', () => {
      const input = new MessageBuilder().setContent('hi').buildCreate('room_1')
      expect(input.idempotencyKey).toBeUndefined()
      expect(input.createThread).toBeUndefined()
      expect(input.attachmentDescriptions).toBeUndefined()
    })

    it('addFile keeps a description alongside the file', () => {
      const file = { data: new Uint8Array([1]), filename: 'a.png' }
      const b = new MessageBuilder().addFile(file, 'alt')
      expect(b.getPendingFiles()).toEqual([{ file, description: 'alt' }])
      expect(b.getFiles()).toEqual([file])
    })

    it('clone copies the new fields independently', () => {
      const original = new MessageBuilder().setContent('x').setCreateThread().addAttachment('as_1', 'd')
      const copy = original.clone().setAttachmentDescription('as_1', 'changed')
      expect(original.buildCreate('r').attachmentDescriptions).toEqual([{ assetId: 'as_1', description: 'd' }])
      expect(copy.buildCreate('r')).toMatchObject({
        createThread: true,
        attachmentDescriptions: [{ assetId: 'as_1', description: 'changed' }],
      })
    })
  })
})
