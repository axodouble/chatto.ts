import { describe, it, expect } from 'bun:test'
import { toReactionName } from '../../src/util/emoji'

describe('toReactionName', () => {
  it('passes shortcode names through and strips surrounding colons', () => {
    expect(toReactionName('heart')).toBe('heart')
    expect(toReactionName(':thumbsup:')).toBe('thumbsup')
    expect(toReactionName('wave::skin-tone-3')).toBe('wave::skin-tone-3')
    expect(toReactionName('+1')).toBe('+1')
  })

  it('maps Unicode emoji to the official client primary names', () => {
    expect(toReactionName('👍')).toBe('thumbsup')
    expect(toReactionName('👎')).toBe('thumbsdown')
    expect(toReactionName('😆')).toBe('laughing')
    expect(toReactionName('👋🏽')).toBe('wave::skin-tone-4')
  })

  it('tolerates a missing or extra variation selector', () => {
    expect(toReactionName('❤️')).toBe('heart')
    expect(toReactionName('❤')).toBe('heart')
  })

  it('returns unknown input unchanged so the server reports it', () => {
    expect(toReactionName('not an emoji')).toBe('not an emoji')
  })
})
