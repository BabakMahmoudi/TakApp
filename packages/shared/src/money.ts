export const STROOPS_PER_LUMEN = 10_000_000n;

const STROOPS_PATTERN = /^\d+$/;
const LUMENS_PATTERN = /^(\d+)(?:\.(\d{1,7}))?$/;

export function parseStroops(value: string): bigint {
  if (!STROOPS_PATTERN.test(value)) {
    throw new Error(`Invalid stroop amount: "${value}"`);
  }
  return BigInt(value);
}

export function isStroops(value: string): boolean {
  return STROOPS_PATTERN.test(value);
}

export function zero(): string {
  return '0';
}

export function addStroops(a: string, b: string): string {
  return (parseStroops(a) + parseStroops(b)).toString();
}

export function mulStroops(a: string, n: number): string {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`Invalid stroop multiplier: "${n}"`);
  }
  return (parseStroops(a) * BigInt(n)).toString();
}

export function subStroops(a: string, b: string): string {
  return (parseStroops(a) - parseStroops(b)).toString();
}

export function compareStroops(a: string, b: string): -1 | 0 | 1 {
  const left = parseStroops(a);
  const right = parseStroops(b);
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function isZeroStroops(value: string): boolean {
  return parseStroops(value) === 0n;
}

export function isPositiveStroops(value: string): boolean {
  if (!STROOPS_PATTERN.test(value)) return false;
  return parseStroops(value) > 0n;
}

export function lumensFromStroops(stroops: string): string {
  const total = parseStroops(stroops);
  const whole = total / STROOPS_PER_LUMEN;
  const fraction = total % STROOPS_PER_LUMEN;
  if (fraction === 0n) return whole.toString();
  const fractionStr = fraction.toString().padStart(7, '0').replace(/0+$/, '');
  return `${whole}.${fractionStr}`;
}

export function stroopsFromLumens(lumens: string): string {
  const match = LUMENS_PATTERN.exec(lumens);
  if (!match) {
    throw new Error(`Invalid lumen amount: "${lumens}" (max 7 decimal places)`);
  }
  const whole = BigInt(match[1] ?? '0');
  const fraction = match[2] ? BigInt(match[2].padEnd(7, '0')) : 0n;
  return (whole * STROOPS_PER_LUMEN + fraction).toString();
}

export function stroopsFromTokenRaw(raw: bigint | string, decimals: number): string {
  const value = typeof raw === 'string' ? parseStroops(raw) : raw;
  if (value < 0n) {
    throw new Error(`Invalid token raw amount: "${raw}" (must be non-negative)`);
  }
  if (decimals === 7) return value.toString();
  const scale = 10n ** BigInt(Math.abs(7 - decimals));
  if (decimals < 7) return (value * scale).toString();
  return (value / scale).toString();
}
