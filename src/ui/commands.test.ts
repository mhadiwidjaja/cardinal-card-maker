import { describe, expect, it } from 'vitest';
import { matchScore } from './commands';

describe('command bar search', () => {
  it('matches letters in order, ignoring case and spaces', () => {
    expect(matchScore('wc', 'Cards Wording check…')).not.toBeNull();
    expect(matchScore('go tem', 'Go to Templates')).not.toBeNull();
    expect(matchScore('xyz', 'Go to Templates')).toBeNull();
  });

  it('prefers word starts and runs of letters', () => {
    const a = matchScore('stress', 'Templates Stress test this template…')!;
    const b = matchScore('stress', 'Settings Some text with s t r e s s spread')!;
    expect(a).toBeGreaterThan(b);
    expect(matchScore('exp', 'Go to Export')!).toBeGreaterThan(matchScore('exp', 'Cards Download as Excel (.xlsx) please')!);
  });
});

describe('command bar search, multi-word', () => {
  it('finds "go templates" in a long label', () => {
    expect(matchScore('go templates', 'Go to Templates Design how each kind of card looks')).not.toBeNull();
    expect(matchScore('go templates', 'Go to Templates Design how each kind of card looks')!).toBeGreaterThan(matchScore('go templates', 'Go to Game settings Card size, fields, icons, templates')!);
  });
});
