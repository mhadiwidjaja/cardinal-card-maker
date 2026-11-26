import { toText } from '../expr/expr';
import { cardResolver } from '../model/cardContext';
import { isFramingColumn } from '../model/framing';
import type { Game } from '../model/types';
import type { AssetStore } from '../render/assets';
import { canvasBytes, cardLabel, renderFace, type ExportItem, type ExportWarning, type Progress } from './exporters';

export interface GalleryCard {
  key: string;
  name: string;
  set: string;
  number: number;
  src: string;
  details: [string, string][];
}

export interface GalleryOptions {
  widthPx: number;
  fields: string[];
  feedback: boolean;
}

export const FEEDBACK_VOTES = [
  ['fun', 'Fun'],
  ['strong', 'Too strong'],
  ['weak', 'Too weak'],
  ['confusing', 'Confusing'],
] as const;

export interface GalleryMeta {
  game: string;
  /** Identifies this gallery file, so feedback for different galleries doesn't mix in the browser. */
  id: string;
  feedback: boolean;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** JSON that is safe inside a <script> element: "<" is written as its escape code, so "</script>" can't end the script. */
const safeJson = (v: unknown) => JSON.stringify(v).replace(/</g, String.fromCharCode(92) + 'u003c');

export function galleryHtml(title: string, cards: GalleryCard[], made: Date = new Date(), meta: GalleryMeta = { game: title, id: made.toISOString(), feedback: false }): string {
  const voteButtons = FEEDBACK_VOTES.map(([id, label]) => `<button type="button" data-vote="${id}" aria-pressed="false">${label}</button>`).join('');
  const items = cards
    .map((c) => {
      const search = [c.name, c.set, ...c.details.map(([, v]) => v)].join(' ').toLowerCase();
      const details = c.details
        .filter(([, v]) => v.trim() !== '')
        .map(([k, v]) => `<div><b>${esc(k)}</b> ${esc(v)}</div>`)
        .join('');
      const fb = meta.feedback ? `<div class="fb">${voteButtons}<textarea placeholder="Note (optional)" aria-label="Note for ${esc(c.name)}" rows="2"></textarea></div>` : '';
      return `<figure data-key="${esc(c.key)}" data-search="${esc(search)}"><img src="${c.src}" alt="${esc(c.name)}" loading="lazy"><figcaption><strong>${esc(c.name)}</strong> <span class="num">${esc(c.set)} #${c.number}</span>${details}</figcaption>${fb}</figure>`;
    })
    .join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
:root { color-scheme: light dark; --bg: #f4f4f6; --panel: #fff; --text: #1d1d22; --muted: #666; }
@media (prefers-color-scheme: dark) { :root { --bg: #18181c; --panel: #24242a; --text: #eee; --muted: #aaa; } }
body { margin: 0; font: 14px/1.4 system-ui, sans-serif; background: var(--bg); color: var(--text); }
header { position: sticky; top: 0; display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; padding: 10px 16px; background: var(--panel); box-shadow: 0 1px 4px rgba(0,0,0,.15); z-index: 1; }
h1 { font-size: 18px; margin: 0; }
input { font: inherit; padding: 6px 10px; border-radius: 6px; border: 1px solid #8884; min-width: 220px; background: var(--bg); color: var(--text); }
.count, .num, footer { color: var(--muted); }
main { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; padding: 16px; }
figure { margin: 0; background: var(--panel); border-radius: 10px; padding: 8px; box-shadow: 0 1px 3px rgba(0,0,0,.15); }
figure img { width: 100%; height: auto; display: block; border-radius: 6px; cursor: zoom-in; }
figcaption { padding: 6px 2px 0; font-size: 12px; white-space: pre-wrap; }
figcaption strong { font-size: 14px; }
figure[hidden] { display: none; }
#big { position: fixed; inset: 0; background: rgba(0,0,0,.85); display: none; align-items: center; justify-content: center; cursor: zoom-out; z-index: 2; }
#big.open { display: flex; }
#big img { max-width: 95vw; max-height: 95vh; border-radius: 12px; }
footer { padding: 0 16px 24px; font-size: 12px; }
.fb { display: flex; flex-wrap: wrap; gap: 4px; padding-top: 6px; }
.fb button { font: inherit; font-size: 12px; padding: 3px 8px; border-radius: 12px; border: 1px solid #8886; background: var(--bg); color: var(--text); cursor: pointer; }
.fb button[aria-pressed="true"] { background: #4b5bd6; border-color: #4b5bd6; color: #fff; }
.fb textarea { width: 100%; box-sizing: border-box; font: inherit; font-size: 12px; border-radius: 6px; border: 1px solid #8884; background: var(--bg); color: var(--text); padding: 4px 6px; }
.send { display: flex; gap: 8px; align-items: center; }
.send input { min-width: 140px; }
.send button { font: inherit; padding: 6px 12px; border-radius: 6px; border: none; background: #4b5bd6; color: #fff; cursor: pointer; }
</style>
</head>
<body>
<header><h1>${esc(title)}</h1><input type="search" id="q" placeholder="Search cards…" aria-label="Search cards"><span class="count" id="count">${cards.length} cards</span>${
    meta.feedback
      ? '<span class="send"><input id="who" placeholder="Your name" aria-label="Your name"><button type="button" id="send">Send feedback</button><span class="count" id="fbcount"></span></span>'
      : ''
  }</header>
<main id="cards">
${items}
</main>
<footer>Made with Cardinal on ${esc(made.toISOString().slice(0, 10))}.</footer>
<div id="big" role="dialog" aria-label="Card"><img alt=""></div>
<script>
const figs = [...document.querySelectorAll('figure')];
const count = document.getElementById('count');
document.getElementById('q').addEventListener('input', (e) => {
  const words = e.target.value.toLowerCase().split(/\\s+/).filter(Boolean);
  let shown = 0;
  for (const f of figs) {
    const ok = words.every((w) => f.dataset.search.includes(w));
    f.hidden = !ok;
    if (ok) shown++;
  }
  count.textContent = shown + ' of ' + figs.length + ' cards';
});
const big = document.getElementById('big');
document.getElementById('cards').addEventListener('click', (e) => {
  if (e.target.tagName !== 'IMG') return;
  big.querySelector('img').src = e.target.src;
  big.querySelector('img').alt = e.target.alt;
  big.classList.add('open');
});
big.addEventListener('click', () => big.classList.remove('open'));
document.addEventListener('keydown', (e) => e.key === 'Escape' && big.classList.remove('open'));
const META = ${safeJson(meta)};
if (META.feedback) {
  // Votes and notes stay in this browser until "Send feedback" saves them as a file for the designer.
  const store = 'card-maker-feedback:' + META.id;
  let fb = {};
  try { fb = JSON.parse(localStorage.getItem(store) || '{}'); } catch {}
  const save = () => {
    try { localStorage.setItem(store, JSON.stringify(fb)); } catch {}
    const n = Object.values(fb).filter((c) => c.votes.length || c.note).length;
    document.getElementById('fbcount').textContent = n ? n + ' cards rated' : '';
  };
  try { document.getElementById('who').value = localStorage.getItem('card-maker-feedback:name') || ''; } catch {}
  for (const f of figs) {
    const key = f.dataset.key;
    const entry = () => (fb[key] ??= { votes: [], note: '' });
    for (const b of f.querySelectorAll('[data-vote]')) {
      b.setAttribute('aria-pressed', String(!!fb[key]?.votes.includes(b.dataset.vote)));
      b.addEventListener('click', () => {
        const e = entry();
        const v = b.dataset.vote;
        e.votes = e.votes.includes(v) ? e.votes.filter((x) => x !== v) : [...e.votes, v];
        b.setAttribute('aria-pressed', String(e.votes.includes(v)));
        save();
      });
    }
    const note = f.querySelector('textarea');
    note.value = fb[key]?.note || '';
    note.addEventListener('input', () => { entry().note = note.value; save(); });
  }
  save();
  document.getElementById('send').addEventListener('click', () => {
    const who = document.getElementById('who').value.trim() || 'playtester';
    try { localStorage.setItem('card-maker-feedback:name', who); } catch {}
    const cards = {};
    for (const [k, v] of Object.entries(fb)) if (v.votes.length || v.note.trim()) cards[k] = { votes: v.votes, note: v.note.trim() };
    const data = { formatVersion: 1, kind: 'card-maker-feedback', game: META.game, gallery: META.id, reviewer: who, date: new Date().toISOString(), cards };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.download = 'feedback-' + who.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + data.date.slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
  });
}
</script>
</body>
</html>
`;
}

export function galleryFields(game: Game): string[] {
  const name = game.def.fields.find((f) => f.identifying)?.id ?? 'name';
  return game.def.fields.filter((f) => f.id !== name && f.type !== 'image' && f.type !== 'color' && f.source !== 'templates' && f.role !== 'quantity').map((f) => f.id);
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export async function exportGallery(
  game: Game,
  items: ExportItem[],
  o: GalleryOptions,
  assets: AssetStore,
  onProgress: (p: Progress) => void,
  signal?: AbortSignal,
): Promise<{ html: string; cards: number; warnings: ExportWarning[] }> {
  const warnings: ExportWarning[] = [];
  const dpi = (o.widthPx / game.def.card.widthMm) * 25.4;
  const label = (id: string) => game.def.fields.find((f) => f.id === id)?.label ?? id;
  const cards: GalleryCard[] = [];
  for (let i = 0; i < items.length; i++) {
    if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
    const item = items[i]!;
    onProgress({ done: i, total: items.length, label: cardLabel(game, item) });
    const canvas = await renderFace(game, item, 'front', dpi, false, assets, warnings);
    const bytes = await canvasBytes(canvas, 'jpeg', 0.85);
    const resolve = cardResolver(game, item.card, item.set);
    const details: [string, string][] = o.fields
      .filter((f) => !isFramingColumn(f, game.def.fields))
      .map((f) => {
        let v = '';
        try {
          v = toText(resolve(f) ?? '');
        } catch {
          v = item.card.values[f] ?? '';
        }
        return [label(f), v];
      });
    cards.push({ key: `${item.set.id}/${item.card.id}`, name: cardLabel(game, item), set: item.set.def.name, number: item.card.row - 1, src: `data:image/jpeg;base64,${toBase64(bytes)}`, details });
    await new Promise((r) => setTimeout(r, 0));
  }
  onProgress({ done: items.length, total: items.length, label: 'Writing the page' });
  const made = new Date();
  const meta: GalleryMeta = { game: game.def.name, id: `${game.id}-${made.toISOString()}`, feedback: o.feedback };
  return { html: galleryHtml(`${game.def.name}: card gallery`, cards, made, meta), cards: cards.length, warnings };
}
