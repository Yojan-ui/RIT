// One-time pad over the sifted BB84 key: ciphertext = plaintext XOR key.
// Alice encrypts with her copy of the key, Bob decrypts with his.

export const toAscii = (s: string) => s.replace(/[^\x20-\x7e]/g, '')

export function keyBytes(bits: string, count: number): Uint8Array {
  const out = new Uint8Array(count)
  for (let i = 0; i < count; i++) out[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2)
  return out
}

export interface OtpRun {
  plain: Uint8Array
  cipher: Uint8Array
  bob: Uint8Array
  corrupted: boolean[]
  integrity: number
  keyBitsUsed: number
}

export function runOtp(message: string, aliceKey: string, bobKey: string): OtpRun | null {
  const plain = new TextEncoder().encode(message)
  const needed = plain.length * 8
  if (plain.length === 0 || aliceKey.length < needed || bobKey.length < needed) return null
  const ka = keyBytes(aliceKey, plain.length)
  const kb = keyBytes(bobKey, plain.length)
  const cipher = plain.map((b, i) => b ^ ka[i])
  const bob = cipher.map((c, i) => c ^ kb[i])
  const corrupted = Array.from(plain, (b, i) => bob[i] !== b)
  const ok = corrupted.filter((c) => !c).length
  return { plain, cipher, bob, corrupted, integrity: ok / plain.length, keyBitsUsed: needed }
}

export const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ')

export const GLITCH = '░▒▓█▚▞▙▟■□◆◇※§¤#%&@$!?<>/\\{}[]~^'

/** Printable ASCII passes through; anything else becomes a glitch glyph. */
export const renderByte = (b: number, salt: number) =>
  b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : GLITCH[(b + salt) % GLITCH.length]
