import { describe, expect, it } from 'vitest';
import { galleryHtml } from './gallery';

describe('galleryHtml', () => {
  const page = galleryHtml(
    'Demo <TCG>',
    [
      { key: 'core/c001', name: 'Ember "Scout"', set: 'Core', number: 1, src: 'data:image/jpeg;base64,AAAA', details: [['Rules', 'Deal 2 & <draw>'], ['Cost', '']] },
      { key: 'core/c005', name: 'Tide Caller', set: 'Core', number: 2, src: 'data:image/jpeg;base64,BBBB', details: [] },
    ],
    new Date('2026-11-20T10:00:00Z'),
  );

  it('is one self-contained page with every card', () => {
    expect(page.startsWith('<!doctype html>')).toBe(true);
    expect(page.match(/<figure /g)).toHaveLength(2);
    expect(page).toContain('src="data:image/jpeg;base64,AAAA"');
    expect(page).not.toMatch(/src="https?:/);
    expect(page).toContain('2026-11-20');
  });

  it('escapes names and values', () => {
    expect(page).toContain('<title>Demo &lt;TCG&gt;</title>');
    expect(page).toContain('Ember &quot;Scout&quot;');
    expect(page).toContain('Deal 2 &amp; &lt;draw&gt;');
    expect(page).not.toContain('<b>Cost</b>');
  });

  it('makes everything searchable in lower case', () => {
    expect(page).toContain('data-search="ember &quot;scout&quot; core deal 2 &amp; &lt;draw&gt; "');
  });
});
