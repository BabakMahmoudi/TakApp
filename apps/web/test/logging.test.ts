import { describe, expect, it } from 'vitest';
import { serializeError } from '../src/server/logging';

describe('serializeError', () => {
  it('includes the name and message', () => {
    const error = new Error('boom');
    expect(serializeError(error)).toContain('Error: boom');
  });

  it('captures enumerable own properties (workerd runtime errors)', () => {
    const error = new Error('internal error; reference = abc123') as Error & { remote: boolean; overloaded: boolean };
    error.remote = true;
    error.overloaded = true;
    const serialized = serializeError(error);
    expect(serialized).toContain('internal error; reference = abc123');
    expect(serialized).toContain('remote=true');
    expect(serialized).toContain('overloaded=true');
  });

  it('walks the cause chain', () => {
    const inner = new Error('inner failure');
    const outer = new Error('outer failure');
    outer.cause = inner;
    const serialized = serializeError(outer);
    expect(serialized).toContain('outer failure');
    expect(serialized).toContain('inner failure');
  });

  it('never throws on circular structures', () => {
    const circular: Record<string, unknown> = { name: 'loop' };
    circular.self = circular;
    const error = new Error('circular');
    (error as unknown as Record<string, unknown>).extra = circular;
    expect(() => serializeError(error)).not.toThrow();
    expect(serializeError(error)).toContain('[circular]');
  });

  it('stringifies plain non-Error values', () => {
    expect(serializeError({ status: 500 })).toContain('status');
    expect(serializeError('plain string')).toContain('plain string');
  });
});
