// NEAR amounts are 24-decimal strings on the wire and `bigint` yoctoNEAR in the SDK, and a deploy
// script that gets the decimal places wrong spends a million times too much. Both directions live
// here so there is one place to check.
export const YOCTO_PER_NEAR = 1_000_000_000_000_000_000_000_000n;

export const near = (amount: string): bigint => {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(amount.trim());
  if (match === null) throw new RangeError(`not a NEAR amount: "${amount}"`);
  const whole = BigInt(match[1] ?? "0") * YOCTO_PER_NEAR;
  const fraction = (match[2] ?? "").padEnd(24, "0").slice(0, 24);
  return whole + BigInt(fraction);
};

/** A fixed-point integer with `decimals` places, printed the way the RPC prints an amount. */
export const formatUnits = (value: bigint, decimals: number): string => {
  const sign = value < 0n ? "-" : "";
  const abs = value < 0n ? -value : value;
  const scale = 10n ** BigInt(decimals);
  const whole = abs / scale;
  const fraction = (abs % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction.length === 0 ? `${sign}${whole}` : `${sign}${whole}.${fraction}`;
};

export const formatNear = (yocto: bigint): string => formatUnits(yocto, 24);

/** A token amount with `decimals` places, as the decimal string NEP-141 uses. */
export const token = (amount: string, decimals: number): bigint => {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(amount.trim());
  if (match === null) throw new RangeError(`not a token amount: "${amount}"`);
  const whole = BigInt(match[1] ?? "0") * 10n ** BigInt(decimals);
  const fraction = (match[2] ?? "").padEnd(decimals, "0").slice(0, decimals);
  return whole + BigInt(fraction);
};
