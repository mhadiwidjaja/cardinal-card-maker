import { describe, expect, it } from 'vitest';
import { MemoryFs } from './memoryFs';
import { FileNotFoundError } from './types';

describe('MemoryFs', () => {
  it('lists files and folders of a directory', async () => {
    const fs = new MemoryFs('x', { 'a/b.txt': '1', 'a/c/d.txt': '2', 'e.txt': '3' });
    expect(await fs.list('')).toEqual([
      { name: 'a', kind: 'directory' },
      { name: 'e.txt', kind: 'file' },
    ]);
    expect(await fs.list('a')).toEqual([
      { name: 'b.txt', kind: 'file' },
      { name: 'c', kind: 'directory' },
    ]);
  });

  it('reports missing files and folders', async () => {
    const fs = new MemoryFs('x', { 'a/b.txt': '1' });
    expect(await fs.exists('a')).toBe(true);
    expect(await fs.exists('a/b.txt')).toBe(true);
    expect(await fs.exists('nope')).toBe(false);
    await expect(fs.readText('nope.txt')).rejects.toBeInstanceOf(FileNotFoundError);
    await expect(fs.list('nope')).rejects.toBeInstanceOf(FileNotFoundError);
  });

  it('keeps a .bak copy of the previous version on write', async () => {
    const fs = new MemoryFs('x', { 'a.csv': 'old' });
    await fs.writeText('a.csv', 'new');
    expect(await fs.readText('a.csv')).toBe('new');
    expect(await fs.readText('a.csv.bak')).toBe('old');
  });

  it('refuses writes when read-only', async () => {
    const fs = new MemoryFs('x', {}, false);
    await expect(fs.writeText('a.txt', 'x')).rejects.toThrow(/read-only/);
  });
});
