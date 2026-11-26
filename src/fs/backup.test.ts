import { describe, expect, it } from 'vitest';
import { backupWorkspace } from './backup';
import { MemoryFs } from './memoryFs';

describe('backupWorkspace', () => {
  it('copies json and csv files, skipping assets, exports and old backups', async () => {
    const fs = new MemoryFs('ws', {
      'workspace.json': '{}',
      'games/g/game.json': '{"name":"G"}',
      'games/g/sets/core/cards.csv': 'id\nc1\n',
      'games/g/assets/icons/x.svg': '<svg/>',
      'games/g/export/a.json': '{}',
      'backups/old/workspace.json': '{}',
    });
    const r = await backupWorkspace(fs, new Date(2026, 10, 8, 9, 5, 3));
    expect(r).toEqual({ folder: 'backups/2026-11-08_090503', files: 3 });
    expect(await fs.readText('backups/2026-11-08_090503/games/g/sets/core/cards.csv')).toBe('id\nc1\n');
    expect(await fs.exists('backups/2026-11-08_090503/games/g/assets')).toBe(false);
  });
});
