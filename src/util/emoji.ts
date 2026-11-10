import { EMOJI_NAMES } from './emoji-names.gen'

const NAME_PATTERN = /^[A-Za-z0-9_+-]+(?:::skin-tone-[2-6])?$/
const VS16 = '️'

/**
 * Convert a reaction input into the name Chatto expects.
 *
 * Chatto 0.5 stores reactions by shortcode name (e.g. `thumbsup`, `heart`,
 * `wave::skin-tone-3`) and rejects Unicode glyphs. This accepts either form:
 * names pass through unchanged (surrounding colons are stripped), and a single
 * Unicode emoji is mapped to the same primary name the official client uses.
 * Unknown input is returned as-is so the server reports the error.
 */
export function toReactionName(emoji: string): string {
  let input = emoji.trim()
  if (input.length > 2 && input.startsWith(':') && input.endsWith(':')) input = input.slice(1, -1)
  if (NAME_PATTERN.test(input)) return input
  return (
    EMOJI_NAMES[input] ??
    EMOJI_NAMES[input + VS16] ??
    EMOJI_NAMES[input.replaceAll(VS16, '')] ??
    input
  )
}
