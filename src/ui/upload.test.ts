import { describe, expect, it } from 'vitest';
import { MemoryFs } from '../fs/memoryFs';
import { replaceQuestion, uploadFiles } from './upload';

const blob = (s: string) => new Blob([s]);

describe('uploadFiles', () => {
  it('writes new files without asking', async () => {
    const fs = new MemoryFs('w');
    let asked = 0;
    const r = await uploadFiles(fs, 'g/assets/icons', [{ name: 'fire.svg', data: blob('new') }], () => (asked++, true));
    expect(asked).toBe(0);
    expect(r.written).toEqual(['fire.svg']);
    expect(await fs.readText('g/assets/icons/fire.svg')).toBe('new');
  });

  it('asks once and keeps existing files on Cancel', async () => {
    const fs = new MemoryFs('w', { 'a/fire.svg': 'old', 'a/water.svg': 'old' });
    const questions: string[] = [];
    const r = await uploadFiles(
      fs,
      'a',
      [
        { name: 'fire.svg', data: blob('new') },
        { name: 'water.svg', data: blob('new') },
        { name: 'earth.svg', data: blob('new') },
      ],
      (q) => (questions.push(q), false),
    );
    expect(questions).toHaveLength(1);
    expect(questions[0]).toContain('fire.svg');
    expect(r).toEqual({ written: ['earth.svg'], kept: ['fire.svg', 'water.svg'] });
    expect(await fs.readText('a/fire.svg')).toBe('old');
    expect(await fs.readText('a/earth.svg')).toBe('new');
  });

  it('replaces on OK and keeps the old file as .bak', async () => {
    const fs = new MemoryFs('w', { 'a/fire.svg': 'old' });
    const r = await uploadFiles(fs, 'a', [{ name: 'fire.svg', data: blob('new') }], () => true);
    expect(r.written).toEqual(['fire.svg']);
    expect(await fs.readText('a/fire.svg')).toBe('new');
    expect(await fs.readText('a/fire.svg.bak')).toBe('old');
  });

  it('lists at most ten names in the question', () => {
    const q = replaceQuestion('a', Array.from({ length: 12 }, (_, i) => `f${i}.png`));
    expect(q).toContain('These 12 files');
    expect(q).toContain('and 2 more');
  });
});
