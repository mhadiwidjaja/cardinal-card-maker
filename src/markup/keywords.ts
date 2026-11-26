import { interpolate } from '../expr/expr';
import type { Keyword } from '../model/types';
import { escapeMarkup } from './markup';

/**
 * Keyword reminder text, e.g. "Shield 2" → "Shield 2 (Prevent the next 2 damage…)".
 *
 * A keyword only counts on a "keyword line": a line made of nothing but
 * keywords separated by commas ("Swift, Shield 2"). So "Swift units you
 * control…" in the middle of a sentence never gets reminder text.
 *
 * Match patterns use {name} or {name:type} for parameters. Types:
 *   number → digits or X     text → anything     word → one word
 */

interface Compiled {
  kw: Keyword;
  re: RegExp;
  params: string[];
}

const PARAM_RE: Record<string, string> = {
  number: '[0-9]+|[Xx]',
  word: '\\S+',
  text: '.+?',
};

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function compileKeywords(keywords: Keyword[]): Compiled[] {
  return keywords.map((kw) => {
    const params: string[] = [];
    let src = '';
    let last = 0;
    for (const m of kw.match.matchAll(/\{(\w+)(?::(\w+))?\}/g)) {
      src += escapeRe(kw.match.slice(last, m.index));
      params.push(m[1]!);
      src += `(${PARAM_RE[m[2] ?? 'text'] ?? PARAM_RE.text})`;
      last = m.index! + m[0].length;
    }
    src += escapeRe(kw.match.slice(last));
    return { kw, re: new RegExp(`^${src}$`, 'i'), params };
  });
}

export type ReminderMode = 'auto' | 'all' | 'none';

/**
 * Adds reminder text to keyword lines.
 * mode "auto" follows each keyword's own `auto` setting; "all" always adds
 * reminders; "none" never does.
 */
export function addReminders(text: string, compiled: Compiled[], mode: ReminderMode = 'auto'): string {
  if (mode === 'none' || compiled.length === 0) return text;
  const used = new Set<string>();
  return text
    .split(/\r?\n|\\n/)
    .map((line) => {
      const items = line.split(',');
      const matches = items.map((item) => {
        const trimmed = item.trim();
        for (const c of compiled) {
          const m = c.re.exec(trimmed);
          if (m) return { c, m };
        }
        return null;
      });
      if (matches.some((m) => m === null) || items.every((i) => i.trim() === '')) return line;

      const reminders: string[] = [];
      for (const hit of matches) {
        const { c, m } = hit!;
        const auto = mode === 'all' ? 'always' : (c.kw.auto ?? 'always');
        if (!c.kw.reminder || auto === 'never') continue;
        if (auto === 'firstUse' && used.has(c.kw.name)) continue;
        used.add(c.kw.name);
        const values: Record<string, string> = {};
        c.params.forEach((p, i) => (values[p] = m[i + 1] ?? ''));
        try {
          reminders.push(interpolate(c.kw.reminder, (n) => values[n]));
        } catch {
          reminders.push(c.kw.reminder);
        }
      }
      if (reminders.length === 0) return line;
      return `${line.trimEnd()} _${escapeMarkup(reminders.join(' '))}_`;
    })
    .join('\n');
}
