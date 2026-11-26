import { joinPath, type FileStore } from './types';

export async function backupWorkspace(fs: FileStore, now = new Date()): Promise<{ folder: string; files: number }> {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const folder = joinPath('backups', stamp);
  let files = 0;
  const walk = async (dir: string) => {
    for (const e of await fs.list(dir)) {
      const p = joinPath(dir, e.name);
      if (e.kind === 'directory') {
        if (e.name === 'backups' || e.name === 'export' || e.name === 'assets') continue;
        await walk(p);
      } else if (/\.(json|csv)$/i.test(e.name)) {
        await fs.writeText(joinPath(folder, p), await fs.readText(p), { force: true });
        files++;
      }
    }
  };
  await walk('');
  return { folder, files };
}
