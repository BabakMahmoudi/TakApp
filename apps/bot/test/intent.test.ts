import { describe, expect, it } from 'vitest';
import { parseIntentJson } from '../src/intent/parse';

describe('intent parsing', () => {
  it('parses valid read-only intents', () => {
    expect(parseIntentJson('{"action":"balance"}')).toEqual({ action: 'balance' });
    expect(parseIntentJson('{"action":"balance","asset":"TAK"}')).toEqual({
      action: 'balance',
      asset: 'TAK',
    });
    expect(parseIntentJson('{"action":"shops"}')).toEqual({ action: 'shops' });
    expect(parseIntentJson('{"action":"history","limit":5}')).toEqual({ action: 'history', limit: 5 });
  });

  it('rejects non-JSON output', () => {
    expect(() => parseIntentJson('sure, here is your balance: 100')).toThrow();
    expect(() => parseIntentJson('')).toThrow();
  });

  it('rejects unsupported (privileged) actions', () => {
    expect(() => parseIntentJson('{"action":"send","to":"G...","amount":100}')).toThrow();
    expect(() => parseIntentJson('{"action":"transfer"}')).toThrow();
    expect(() => parseIntentJson('{"action":"delete_all_funds"}')).toThrow();
  });

  it('rejects ambiguous output such as multiple intents', () => {
    expect(() => parseIntentJson('{"action":"balance"} {"action":"shops"}')).toThrow();
    expect(() => parseIntentJson('[{"action":"balance"}]')).toThrow();
  });

  it('rejects invalid values', () => {
    expect(() => parseIntentJson('{"action":"balance","asset":"DOGE"}')).toThrow();
    expect(() => parseIntentJson('{"action":"history","limit":9999}')).toThrow();
  });
});
