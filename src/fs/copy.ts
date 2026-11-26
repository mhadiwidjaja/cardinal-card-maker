import { joinPath, type FileStore } from './types';

const TEXT = /\.(json|csv|txt|md|svg|tsv)$/i;

export async function copyTree(from: FileStore, to: FileStore, fromDir = '', toDir = ''): Promise<number> {
  let n = 0;
  for (const entry of await from.list(fromDir)) {
    const src = joinPath(fromDir, entry.name);
    const dst = joinPath(toDir, entry.name);
    if (entry.kind === 'directory') {
      n += await copyTree(from, to, src, dst);
    } else if (TEXT.test(entry.name)) {
      await to.writeText(dst, await from.readText(src), { force: true });
      n++;
    } else {
      await to.writeBlob(dst, await from.readBlob(src));
      n++;
    }
  }
  return n;
}
