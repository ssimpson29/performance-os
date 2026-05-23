import { describe, expect, it } from 'vitest';

import { buildSystemPrompt } from '../lib/agents/longevity-guru';

describe('Longevity Guru buildSystemPrompt — soul injection', () => {
  it('omits the soul block when no soul is passed', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).not.toMatch(/ATHLETE SOUL/);
    // Base prompt anchors still present:
    expect(prompt).toMatch(/Longevity Guru/);
    expect(prompt).toMatch(/healthspan, not race day/);
  });

  it('omits the soul block when the soul is empty / whitespace', () => {
    const prompt = buildSystemPrompt('   \n\n  ');
    expect(prompt).not.toMatch(/ATHLETE SOUL/);
  });

  it('injects the soul body verbatim and instructs the LLM to frame through it', () => {
    const soul = 'I value Peter Attia and Paul Saladino on health topics. Prefer ancestral / animal-based framing.';
    const prompt = buildSystemPrompt(soul);
    expect(prompt).toContain('=== ATHLETE SOUL (longevity) ===');
    expect(prompt).toContain('=== END ATHLETE SOUL (longevity) ===');
    expect(prompt).toContain(soul);
    // Framing instruction present:
    expect(prompt).toMatch(/Frame every recommendation through it/);
    expect(prompt).toMatch(/doctors or thinkers they trust/i);
    expect(prompt).toMatch(/Attia/);
  });

  it('keeps the conflict-resolution rule regardless of soul', () => {
    const prompt = buildSystemPrompt('anything');
    expect(prompt).toMatch(/sustained-signal-wins-for-longevity/);
    expect(prompt).toMatch(/acute-need-wins-for-training/);
  });
});
