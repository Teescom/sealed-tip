// The X25519 identities a deployment registers on chain: the keeper's, and one per panel member.
// They are made once and then live in `.env`, because a key that changes between runs strands
// everything already sealed to the old public half.
import { fromHex as hexToBytes, newX25519KeyPair, x25519PublicKey } from "@sealedtip/crypto";

import type { EnvMap } from "./env.js";

export const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

/** An X25519 secret is exactly 32 bytes, so a truncated `.env` value is a different key, not a typo. */
export const fromHex = (raw: string, name: string): Uint8Array => {
  const bytes = hexToBytes(raw);
  if (bytes.length !== 32) throw new Error(`${name} must be 64 hex characters (a 32-byte X25519 secret), got ${bytes.length} bytes`);
  return bytes;
};

export interface X25519Identity {
  readonly envVar: string;
  readonly secret: Uint8Array;
  readonly publicKey: Uint8Array;
  /** True when this run minted it, so the caller knows to persist it before anything uses it. */
  readonly generated: boolean;
}

export const ensureX25519 = async (env: EnvMap, envVar: string): Promise<X25519Identity> => {
  const stored = env[envVar] ?? "";
  const secret = stored.length === 0 ? (await newX25519KeyPair()).secretKey : fromHex(stored, envVar);
  return { envVar, secret, publicKey: await x25519PublicKey(secret), generated: stored.length === 0 };
};
