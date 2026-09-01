import { describe, expect, it } from 'vitest';
import {
  addStroops,
  compareStroops,
  isPositiveStroops,
  lumensFromStroops,
  parseStroops,
  stroopsFromLumens,
  stroopsFromTokenRaw,
  subStroops,
} from '../src/money';

describe('money', () => {
  it('parses integer stroop strings and rejects non-numeric input', () => {
    expect(parseStroops('0')).toBe(0n);
    expect(parseStroops('10000000')).toBe(10_000_000n);
    expect(() => parseStroops('1.5')).toThrow();
    expect(() => parseStroops('-5')).toThrow();
    expect(() => parseStroops('abc')).toThrow();
  });

  it('converts lumens to stroops without floats', () => {
    expect(stroopsFromLumens('1')).toBe('10000000');
    expect(stroopsFromLumens('1.5')).toBe('15000000');
    expect(stroopsFromLumens('0.0000001')).toBe('1');
    expect(stroopsFromLumens('123.0000007')).toBe('1230000007');
  });

  it('rejects lumen strings with more than 7 decimals', () => {
    expect(() => stroopsFromLumens('0.00000001')).toThrow();
    expect(() => stroopsFromLumens('abc')).toThrow();
  });

  it('converts stroops to lumen strings, trimming trailing zeros', () => {
    expect(lumensFromStroops('0')).toBe('0');
    expect(lumensFromStroops('10000000')).toBe('1');
    expect(lumensFromStroops('15000000')).toBe('1.5');
    expect(lumensFromStroops('1')).toBe('0.0000001');
    expect(lumensFromStroops('1230000007')).toBe('123.0000007');
  });

  it('adds and subtracts stroop strings', () => {
    expect(addStroops('1', '2')).toBe('3');
    expect(addStroops('10000000', '5000000')).toBe('15000000');
    expect(subStroops('15000000', '5000000')).toBe('10000000');
    expect(subStroops('5', '5')).toBe('0');
  });

  it('compares and classifies stroop amounts', () => {
    expect(compareStroops('1', '2')).toBe(-1);
    expect(compareStroops('2', '1')).toBe(1);
    expect(compareStroops('1', '1')).toBe(0);
    expect(isPositiveStroops('1')).toBe(true);
    expect(isPositiveStroops('0')).toBe(false);
  });

  it('scales SEP-41 token raw integers to the 7-decimal stroop scale', () => {
    expect(stroopsFromTokenRaw(50_000_000_000n, 7)).toBe('50000000000');
    expect(stroopsFromTokenRaw('50000000000', 7)).toBe('50000000000');
    expect(stroopsFromTokenRaw(0n, 7)).toBe('0');
    expect(stroopsFromTokenRaw(5000n, 6)).toBe('50000');
    expect(stroopsFromTokenRaw(500_000_000_000n, 8)).toBe('50000000000');
  });

  it('rejects negative token raw amounts', () => {
    expect(() => stroopsFromTokenRaw(-1n, 7)).toThrow();
  });
});
