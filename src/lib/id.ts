// Crypto helpers: random IDs, address generation, token hashing.
// No external randomness libs — uses Web Crypto, available in Workers.

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const ADDR_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"; // no ambiguous chars

function randomString(length: number, alphabet: string): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

/** Public, URL-safe identifier for inboxes and messages. */
export function newId(): string {
  return randomString(20, ID_ALPHABET);
}

/** Local-part of a disposable address, e.g. "k7m9p2qx". */
export function newLocalPart(): string {
  return randomString(10, ADDR_ALPHABET);
}

/** High-entropy bearer token handed to the browser (never stored raw). */
export function newToken(): string {
  return randomString(40, ID_ALPHABET);
}

/** SHA-256 hex digest, used to store tokens at rest. */
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Constant-time string comparison to avoid timing leaks on token checks. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
