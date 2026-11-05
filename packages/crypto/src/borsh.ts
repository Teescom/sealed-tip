/**
 * Minimal borsh writer for `SignedAction` / `Action` / `Payout`. The Rust derive in
 * `contracts/sealedtip/src/types.rs` is authoritative; `fixtures/vectors.json` checks us against it.
 */
export class BorshWriter {
  private readonly out: number[] = [];

  u8(value: number): this {
    assertRange(value, 0, 255, "u8");
    this.out.push(value);
    return this;
  }

  u32(value: number): this {
    assertRange(value, 0, 0xffffffff, "u32");
    for (let i = 0; i < 4; i++) this.out.push((value >>> (i * 8)) & 0xff);
    return this;
  }

  /** borsh `u64`, little-endian. Pass a `bigint` for amounts above 2^53. */
  u64(value: bigint | number): this {
    let v = BigInt(value);
    if (v < 0n || v >= 1n << 64n) throw new TypeError(`u64 out of range: ${value}`);
    for (let i = 0; i < 8; i++) {
      this.out.push(Number(v & 0xffn));
      v >>= 8n;
    }
    return this;
  }

  bool(value: boolean): this {
    return this.u8(value ? 1 : 0);
  }

  /** Fixed-size array: borsh writes `[u8; N]` with no length prefix. */
  fixed(value: Uint8Array, name: string): this {
    if (value.length !== 32) throw new TypeError(`${name} must be 32 bytes, got ${value.length}`);
    this.out.push(...value);
    return this;
  }

  string(value: string): this {
    const bytes = new TextEncoder().encode(value);
    this.u32(bytes.length);
    this.out.push(...bytes);
    return this;
  }

  optionString(value: string | null): this {
    if (value === null) return this.u8(0);
    this.u8(1);
    return this.string(value);
  }

  bytes(): Uint8Array {
    return Uint8Array.from(this.out);
  }
}

function assertRange(value: number, min: number, max: number, name: string): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new TypeError(`${name} out of range: ${value}`);
  }
}
