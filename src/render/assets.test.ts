import { describe, expect, it } from 'vitest';
import { MemoryFs } from '../fs/memoryFs';
import type { Game } from '../model/types';
import { AssetStore } from './assets';

// Images can't be decoded without a browser, so they load as null here. The
// bookkeeping of which file each cached image came from is what is tested.
const game = { id: 'g', path: 'games/g', def: { fonts: [] }, templates: {}, sets: [] } as unknown as Game;

describe('AssetStore.refreshChanged', () => {
  it('keeps the cache when nothing changed', async () => {
    const fs = new MemoryFs('w', { 'games/g/assets/art/a.png': 'x' });
    const assets = new AssetStore(fs, game);
    const first = assets.image('art/a.png');
    await first;
    expect(await assets.refreshChanged()).toBe(false);
    expect(assets.image('art/a.png')).toBe(first);
  });

  it('forgets only the image whose file changed', async () => {
    const fs = new MemoryFs('w', { 'games/g/assets/art/a.png': 'x', 'games/g/assets/art/b.png': 'y' });
    const assets = new AssetStore(fs, game);
    const a = assets.image('art/a.png');
    const b = assets.image('art/b.png');
    await Promise.all([a, b]);
    fs.externalWrite('games/g/assets/art/a.png', 'changed');
    expect(await assets.refreshChanged()).toBe(true);
    expect(assets.image('art/a.png')).not.toBe(a);
    expect(assets.image('art/b.png')).toBe(b);
  });

  it('forgets a missing image once the file appears', async () => {
    const fs = new MemoryFs('w', { 'games/g/assets/art/a.png': 'x' });
    const assets = new AssetStore(fs, game);
    const missing = assets.image('art/new.png');
    expect(await missing).toBeNull();
    expect(await assets.refreshChanged()).toBe(false);
    fs.externalWrite('library/art/new.png', 'now there');
    expect(await assets.refreshChanged()).toBe(true);
    expect(assets.image('art/new.png')).not.toBe(missing);
  });

  it('notices when a game file starts to shadow the library file', async () => {
    const fs = new MemoryFs('w', { 'library/icons/fire.svg': '<svg/>' });
    const assets = new AssetStore(fs, game);
    await assets.image('icons/fire.svg');
    fs.externalWrite('games/g/assets/icons/fire.svg', '<svg/>');
    expect(await assets.refreshChanged()).toBe(true);
  });
});

describe('MemoryFs.modified', () => {
  it('changes when the file is written and is null for missing files', async () => {
    const fs = new MemoryFs('w', { 'a.txt': '1' });
    const t0 = await fs.modified('a.txt');
    await fs.writeText('a.txt', '2');
    expect(await fs.modified('a.txt')).not.toBe(t0);
    expect(await fs.modified('nope.txt')).toBeNull();
  });
});
