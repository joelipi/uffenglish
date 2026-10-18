const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
const BASE = ALPHABET.length;

// The signup form draws a code from a 24-bit space, so the longest code the
// generator can mint is the encoding of the largest in-space value. Deriving
// the bound (instead of writing 5) keeps the shape predicate in step with the
// generator: widen the space and the accepted length follows.
const SHARE_CODE_SPACE = 0xFFFFFF;
const SHORT_ID_MIN_LENGTH = 4;

function toShortId(num, minLength = SHORT_ID_MIN_LENGTH) {
  const n = typeof num === 'string' ? parseInt(num, 10) : num;

  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`toShortId expects a non-negative integer, got: ${num}`);
  }

  let str = "";
  let m = n;
  do {
    str = ALPHABET[m % BASE] + str;
    m = Math.floor(m / BASE);
  } while (m > 0);

  return str.padStart(minLength, ALPHABET[0]);
}

const SHORT_ID_MAX_LENGTH = toShortId(SHARE_CODE_SPACE - 1).length;

/**
 * Normalize a share-code segment for lookup.
 *
 * Share codes are minted lowercase, so an uppercase or mixed-case URL
 * (`/Abcd`) refers to the same code as `/abcd`. Normalizing at the boundary
 * means the database lookup sees the stored shape.
 *
 * @param {unknown} value
 * @returns {unknown} the lowercased string, or the value unchanged when it is
 *   not a string.
 */
function normalizeShareCodeSegment(value) {
  return typeof value === 'string' ? value.toLowerCase() : value;
}

/**
 * Whether a single URL segment has the shape of a share code.
 *
 * `/nonsense` matches the `/:shareCode` route just like `/k9gyi` does, because
 * React Router cannot see the difference. This is the difference: a share code
 * is case-insensitive (uppercase is normalized to lowercase), drawn from
 * ALPHABET, at the generator's min length or longer, and at most the length of
 * the largest code the generator can mint. Anything else is a mistyped path
 * and must fall through to the 404 page.
 *
 * Derived from ALPHABET + SHORT_ID_MIN_LENGTH + the generator's space rather
 * than a second hand-written regex, so changing the generator cannot leave the
 * two out of step.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function isShareCodeSegment(value) {
  if (typeof value !== 'string') return false;
  const normalized = normalizeShareCodeSegment(value);
  if (normalized.length < SHORT_ID_MIN_LENGTH || normalized.length > SHORT_ID_MAX_LENGTH) return false;
  for (const char of normalized) {
    if (!ALPHABET.includes(char)) return false;
  }
  return true;
}

/**
 * Generate a share code from the same 24-bit space the signup form uses.
 *
 * Lives here, beside toShortId, so the code space has a single definition — the
 * signup form and the profile-repair path both draw from it, and two copies of
 * the expression is how the space silently drifts apart.
 */
export function generateShareCode() {
    return toShortId(Math.floor(Math.random() * SHARE_CODE_SPACE));
}

export {
  toShortId,
  ALPHABET,
  SHORT_ID_MIN_LENGTH,
  SHORT_ID_MAX_LENGTH,
  normalizeShareCodeSegment,
  isShareCodeSegment,
};
