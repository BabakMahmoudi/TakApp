import { describe, expect, it } from 'vitest';
import { isLocalHttpUrl } from '../src/url';

describe('isLocalHttpUrl', () => {
  it('allows http on localhost and 127.0.0.1', () => {
    expect(isLocalHttpUrl('http://localhost/api/stellar/horizon')).toBe(true);
    expect(isLocalHttpUrl('http://localhost:8788/horizon')).toBe(true);
    expect(isLocalHttpUrl('http://127.0.0.1:8788/soroban')).toBe(true);
  });

  it('rejects https and remote http hosts', () => {
    expect(isLocalHttpUrl('https://localhost/api/stellar/horizon')).toBe(false);
    expect(isLocalHttpUrl('https://horizon-testnet.stellar.org')).toBe(false);
    expect(isLocalHttpUrl('http://horizon-testnet.stellar.org')).toBe(false);
    expect(isLocalHttpUrl('http://example.com')).toBe(false);
  });
});
