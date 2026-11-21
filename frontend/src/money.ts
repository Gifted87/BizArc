/**
 * Rule 5 (Refuse Silent Rounding): USDC is a 6-decimal STRING end to end.
 * Never Number/parseFloat for balance mutations or transactions.
 */

export class LoudRoundingError extends Error {
  constructor(value: string) {
    super(`LOUD_ROUNDING_ERROR: "${value}" is not an exact USDC amount (max 6 decimals).`);
    this.name = "LoudRoundingError";
  }
}

const RE = /^-?\d+(\.\d{1,6})?$/;
export const isUsdc = (v: string): boolean => RE.test(v);

export function toMicro(v: string): bigint {
  if (!RE.test(v)) throw new LoudRoundingError(v);
  const neg = v.startsWith("-");
  const [i, f = ""] = v.replace("-", "").split(".");
  const n = BigInt(i) * 1_000_000n + BigInt(f.padEnd(6, "0"));
  return neg ? -n : n;
}

export function fromMicro(n: bigint): string {
  const neg = n < 0n;
  const a = neg ? -n : n;
  return `${neg ? "-" : ""}${a / 1_000_000n}.${(a % 1_000_000n).toString().padStart(6, "0")}`;
}

export const sumUsdc = (xs: string[]): string =>
  fromMicro(xs.reduce((a, x) => a + toMicro(x), 0n));

/**
 * Shows cents when exact; never hides a non-zero digit below the cent.
 * 1234.5 -> "$1,234.50", 0.000125 -> "$0.000125".
 */
export function formatUsdc(
  v: string,
  opts: { sign?: boolean; symbol?: boolean } = {}
): string {
  try {
    const micro = toMicro(v);
    const neg = micro < 0n;
    const a = neg ? -micro : micro;
    const whole = (a / 1_000_000n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    let frac = (a % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
    if (frac.length < 2) frac = frac.padEnd(2, "0");
    const s = `${opts.symbol ? "$" : ""}${whole}.${frac}`;
    return neg ? `-${s}` : opts.sign && a > 0n ? `+${s}` : s;
  } catch {
    return v;
  }
}

/** Display-only share percentage (0-100). Safe because it is never fed back into money math. */
export function pctOf(part: string, total: string): number {
  try {
    const t = toMicro(total);
    if (t <= 0n) return 0;
    return Number((toMicro(part) * 10000n) / t) / 100;
  } catch {
    return 0;
  }
}
