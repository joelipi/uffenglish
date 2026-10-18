// Share-code alphabet: all lowercase letters except `l`, plus all digits.
// `o`, `0` and `1` are intentionally kept (the user accepted the small
// confusion risk in exchange for a larger code space); only `l` is excluded.
const ALPHABET = "abcdefghijkmnopqrstuvwxyz0123456789";
const BASE = ALPHABET.length;

// New codes are always exactly five characters. Legacy codes may be four
// characters (early accounts), so the shape gate accepts 4 or 5; generation
// never produces fewer than five.
const SHARE_CODE_MIN_LENGTH = 4;
const SHARE_CODE_MAX_LENGTH = 5;
const GENERATED_CODE_LENGTH = 5;

// 35^5 ≈ 52.5M possible five-character codes.
const SHARE_CODE_SPACE = 35 ** 5;

function toShortId(num, minLength = GENERATED_CODE_LENGTH) {
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
 * Share codes are stored lowercase, so an uppercase or mixed-case URL
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
 * ALPHABET, four or five characters long (legacy codes may be four), and at
 * most five characters. Anything else is a mistyped path and must fall through
 * to the 404 page.
 *
 * Derived from ALPHABET + SHARE_CODE_MIN_LENGTH/SHARE_CODE_MAX_LENGTH rather
 * than a second hand-written regex, so changing the generator cannot leave the
 * two out of step.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function isShareCodeSegment(value) {
  if (typeof value !== 'string') return false;
  const normalized = normalizeShareCodeSegment(value);
  if (normalized.length < SHARE_CODE_MIN_LENGTH || normalized.length > SHARE_CODE_MAX_LENGTH) return false;
  for (const char of normalized) {
    if (!ALPHABET.includes(char)) return false;
  }
  return true;
}

export {
  toShortId,
  ALPHABET,
  SHARE_CODE_MIN_LENGTH,
  SHARE_CODE_MAX_LENGTH,
  GENERATED_CODE_LENGTH,
  normalizeShareCodeSegment,
  isShareCodeSegment,
};

/**
 * Generate a share code from the 35^5 code space.
 *
 * Client-side fallback only. The authoritative generator is the Postgres
 * function `generate_share_code()` (see supabase/migrations), which also
 * filters reserved words and checks uniqueness. This local version does not
 * filter reserved words; it exists for tests and for degrading gracefully if
 * the RPC is unreachable.
 */
export function generateShareCode() {
  return toShortId(Math.floor(Math.random() * SHARE_CODE_SPACE));
}
