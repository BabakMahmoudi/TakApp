import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from '../src/prompt';

describe('system prompt', () => {
  it('treats user content as untrusted and stays read-only', () => {
    const prompt = buildSystemPrompt('CBI3WR5NQZUQ5PAPV4TBCOFMJ3MOJVZVMH5CKCGVOP63YV2SPFZN3Z7C');
    expect(prompt).toContain('untrusted');
    expect(prompt).toContain('read-only');
    expect(prompt).toContain('Never invent data');
    expect(prompt).toContain('Never mention secret keys');
  });
});
