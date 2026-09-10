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

  it('grounds answers in the TAK whitepaper digest', () => {
    const prompt = buildSystemPrompt('CBI3WR5NQZUQ5PAPV4TBCOFMJ3MOJVZVMH5CKCGVOP63YV2SPFZN3Z7C');
    expect(prompt).toContain('community coffee token');
    expect(prompt).toContain('Farahan');
    expect(prompt).toContain('20 g');
    expect(prompt).toContain('SEP-41');
    expect(prompt).toContain('Answer in the user');
  });
});
