import { FEEDBACK_VOTES } from '../export/gallery';
import { joinPath, type FileStore } from '../fs/types';
import type { Game } from './types';

export const FEEDBACK_DIR = 'feedback';

export type Vote = (typeof FEEDBACK_VOTES)[number][0];

export interface FeedbackFile {
  reviewer: string;
  date: string;
  game: string;
  cards: Record<string, { votes: Vote[]; note: string }>;
}

export interface CardFeedback {
  key: string;
  votes: Record<Vote, number>;
  notes: { reviewer: string; text: string }[];
  reviewers: number;
}

const VOTES = new Set<string>(FEEDBACK_VOTES.map(([id]) => id));

export function parseFeedback(text: string): FeedbackFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('This is not a feedback file (not JSON).');
  }
  const d = data as Record<string, unknown>;
  if (d?.kind !== 'card-maker-feedback' || typeof d.cards !== 'object' || d.cards === null) throw new Error('This is not a Cardinal feedback file.');
  const cards: FeedbackFile['cards'] = {};
  for (const [key, raw] of Object.entries(d.cards as Record<string, unknown>)) {
    const c = raw as { votes?: unknown; note?: unknown };
    const votes = Array.isArray(c?.votes) ? (c.votes.filter((v) => typeof v === 'string' && VOTES.has(v)) as Vote[]) : [];
    const note = typeof c?.note === 'string' ? c.note.slice(0, 2000) : '';
    if (votes.length || note.trim()) cards[key] = { votes: [...new Set(votes)], note: note.trim() };
  }
  return {
    reviewer: typeof d.reviewer === 'string' && d.reviewer.trim() ? d.reviewer.trim() : 'playtester',
    date: typeof d.date === 'string' ? d.date : '',
    game: typeof d.game === 'string' ? d.game : '',
    cards,
  };
}

/** Adds up all files per card. A reviewer's newest file replaces their older ones. */
export function summarizeFeedback(files: FeedbackFile[]): CardFeedback[] {
  const newest = new Map<string, FeedbackFile>();
  for (const f of files) {
    const prev = newest.get(f.reviewer.toLowerCase());
    if (!prev || f.date > prev.date) newest.set(f.reviewer.toLowerCase(), f);
  }
  const byCard = new Map<string, CardFeedback>();
  for (const f of newest.values()) {
    for (const [key, c] of Object.entries(f.cards)) {
      let e = byCard.get(key);
      if (!e) {
        e = { key, votes: Object.fromEntries(FEEDBACK_VOTES.map(([id]) => [id, 0])) as Record<Vote, number>, notes: [], reviewers: 0 };
        byCard.set(key, e);
      }
      e.reviewers++;
      for (const v of c.votes) e.votes[v]++;
      if (c.note) e.notes.push({ reviewer: f.reviewer, text: c.note });
    }
  }
  const total = (c: CardFeedback) => Object.values(c.votes).reduce((a, b) => a + b, 0) + c.notes.length;
  return [...byCard.values()].sort((a, b) => total(b) - total(a) || a.key.localeCompare(b.key));
}

export async function loadFeedback(fs: FileStore, game: Game): Promise<{ files: FeedbackFile[]; problems: string[] }> {
  const dir = joinPath(game.path, FEEDBACK_DIR);
  const files: FeedbackFile[] = [];
  const problems: string[] = [];
  if (!(await fs.exists(dir))) return { files, problems };
  for (const e of await fs.list(dir)) {
    if (e.kind !== 'file' || !e.name.toLowerCase().endsWith('.json')) continue;
    try {
      files.push(parseFeedback(await fs.readText(joinPath(dir, e.name))));
    } catch (err) {
      problems.push(`${e.name}: ${(err as Error).message}`);
    }
  }
  return { files, problems };
}

export async function keepFeedback(fs: FileStore, game: Game, fileName: string, text: string): Promise<string> {
  parseFeedback(text);
  const dir = joinPath(game.path, FEEDBACK_DIR);
  const base = fileName.replace(/\.json$/i, '').replace(/[\\/:*?"<>|]/g, '_') || 'feedback';
  let name = `${base}.json`;
  for (let i = 2; await fs.exists(joinPath(dir, name)); i++) name = `${base}-${i}.json`;
  await fs.writeText(joinPath(dir, name), text, { force: true });
  return name;
}
