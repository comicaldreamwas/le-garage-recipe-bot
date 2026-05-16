'use strict';

// Stop words filtered out before keyword extraction. Lower-cased and
// trimmed; kept short because typos in stop words shouldn't matter.
// Arabic stop words use NFC form so they match input directly.
const STOP_WORDS = new Set([
  // English
  'please', 'pls', 'give', 'gimme', 'want', 'need', 'want', 'the', 'a', 'an',
  'me', 'for', 'plz', 'show', 'send', 'recipe', 'how', 'to', 'make', 'cook',
  // Arabic
  'من', 'فضلك', 'أعطني', 'اعطني', 'أريد', 'اريد', 'لو', 'سمحت', 'ممكن',
  'وصفة', 'وصفه', 'كيف', 'اعمل', 'أعمل',
]);

// Emoji + miscellaneous symbols. Uses Unicode property escapes (Node 20+
// has these enabled by default).
const EMOJI_RE = /[\p{Extended_Pictographic}\p{Emoji_Presentation}]/gu;

// Strip everything that isn't a Unicode letter, digit, or whitespace.
// Keep letters from any script (Latin, Arabic, etc.) and digits.
const PUNCTUATION_RE = /[^\p{L}\p{N}\s]/gu;

// Multiple whitespace → single space.
const WHITESPACE_RE = /\s+/g;

/**
 * Normalize free-form user input for keyword matching.
 *
 *   normalizeText("🍕 PIZZA, please!") → "pizza"
 *   normalizeText("من فضلك, شوربة عدس") → "شوربة عدس"
 *
 * Steps:
 *   1. Lower-case (Arabic letters are unaffected).
 *   2. Remove emoji and pictographs.
 *   3. Remove punctuation (keeps letters of any script + digits + spaces).
 *   4. Collapse whitespace.
 *   5. Drop stop words.
 */
function normalizeText(text) {
  if (!text || typeof text !== 'string') return '';

  let out = text.toLowerCase();
  out = out.replace(EMOJI_RE, ' ');
  out = out.replace(PUNCTUATION_RE, ' ');
  out = out.replace(WHITESPACE_RE, ' ').trim();

  if (!out) return '';

  const tokens = out.split(' ').filter((w) => w && !STOP_WORDS.has(w));
  return tokens.join(' ');
}

module.exports = { normalizeText, STOP_WORDS };
