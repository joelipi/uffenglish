const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
const BASE = ALPHABET.length;

function toShortId(num, minLength = 4) {
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

export { toShortId, ALPHABET };
