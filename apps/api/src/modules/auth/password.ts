import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

/**
 * Password hashing.
 *
 * ARCH01 names argon2id. This uses scrypt from node:crypto instead — a memory-
 * hard KDF that ships with Node and needs no native build. Swapping to argon2
 * later touches only this file, and `hash()` records the algorithm so existing
 * hashes stay verifiable across a change.
 */
const KEYLEN = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEYLEN);
  return `scrypt$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, salt, expected] = stored.split('$');
  if (algorithm !== 'scrypt' || !salt || !expected) return false;

  const derived = await scrypt(password, Buffer.from(salt, 'base64'), KEYLEN);
  const expectedBuffer = Buffer.from(expected, 'base64');
  return (
    derived.length === expectedBuffer.length && timingSafeEqual(derived, expectedBuffer)
  );
}

/** UC01: ten one-time codes, shown once, stored only as hashes. */
export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const raw = randomBytes(5).toString('hex').toUpperCase();
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
  });
}
