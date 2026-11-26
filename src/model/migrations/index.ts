import type { Issue } from '../types';

/**
 * File-format migrations. Every JSON file has a `formatVersion`. When a format
 * changes: bump CURRENT_VERSION for that kind and add a step that upgrades
 * version N to N+1. Old projects are upgraded in memory on load and written
 * in the new format on the next save.
 */
export type FileKind = 'workspace' | 'game' | 'template' | 'set';

type Step = (data: Record<string, unknown>) => Record<string, unknown>;

export const CURRENT_VERSION: Record<FileKind, number> = {
  workspace: 1,
  game: 1,
  template: 1,
  set: 1,
};

/** steps[kind][n] upgrades version n to n + 1. */
const steps: Record<FileKind, Record<number, Step>> = {
  workspace: {},
  game: {},
  template: {},
  set: {},
};

export function migrate(kind: FileKind, data: Record<string, unknown>, file: string, issues: Issue[]): Record<string, unknown> | null {
  const current = CURRENT_VERSION[kind];
  const raw = data.formatVersion ?? 1;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1) {
    issues.push({ level: 'error', file, message: `formatVersion must be a whole number, got ${JSON.stringify(raw)}` });
    return null;
  }
  const version = raw;
  if (version > current) {
    issues.push({ level: 'error', file, message: `Made by a newer version of Cardinal (format ${version}; this app reads up to ${current})` });
    return null;
  }
  let out = { ...data };
  for (let v = version; v < current; v++) {
    const step = steps[kind][v];
    if (!step) throw new Error(`Missing ${kind} migration from version ${v}`);
    out = step(out);
  }
  out.formatVersion = current;
  return out;
}
