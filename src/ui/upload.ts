import { joinPath, type FileStore } from '../fs/types';

/**
 * Copies picked files into an assets folder (icons, fonts, art,
 * ICC profiles). writeBlob has no backup, so files that already exist are
 * never replaced silently: we ask once for all of them, and a replaced file's
 * old content is kept as `<name>.bak`. Cancel keeps the existing files.
 */
export async function uploadFiles(
  fs: FileStore,
  dir: string,
  files: { name: string; data: Blob }[],
  confirm: (question: string) => boolean = (q) => window.confirm(q),
): Promise<{ written: string[]; kept: string[] }> {
  const existing: string[] = [];
  for (const f of files) if (await fs.exists(joinPath(dir, f.name))) existing.push(f.name);
  const replace = existing.length === 0 || confirm(replaceQuestion(dir, existing));

  const written: string[] = [];
  const kept: string[] = [];
  for (const f of files) {
    const path = joinPath(dir, f.name);
    if (existing.includes(f.name)) {
      if (!replace) {
        kept.push(f.name);
        continue;
      }
      await fs.writeBlob(path + '.bak', await fs.readBlob(path));
    }
    await fs.writeBlob(path, f.data);
    written.push(f.name);
  }
  return { written, kept };
}

export function replaceQuestion(dir: string, existing: string[]): string {
  const shown = existing.slice(0, 10).map((n) => `  ${n}`);
  if (existing.length > 10) shown.push(`  …and ${existing.length - 10} more`);
  const what = existing.length === 1 ? 'This file already exists' : `These ${existing.length} files already exist`;
  return `${what} in ${dir}:\n\n${shown.join('\n')}\n\nReplace ${existing.length === 1 ? 'it' : 'them'}? The old version is kept as .bak.\n(Cancel keeps the existing ${existing.length === 1 ? 'file' : 'files'} and copies only the new ones.)`;
}
