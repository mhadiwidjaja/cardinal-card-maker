/**
 * Card-text markup → a flat list of tokens for the layout engine.
 *
 *   [fire]        icon (case-insensitive, aliases allowed)
 *   [[            a literal "["
 *   *bold*        bold      (a lone * with no partner stays a literal *)
 *   _italic_      italic    (same rule for _)
 *   \* \_ \[ \\   escapes
 *   line break    new line (a real line break, or the two characters \n)
 */

export interface TextStyle {
  bold: boolean;
  italic: boolean;
}

export type Token =
  | { kind: 'text'; text: string; style: TextStyle }
  | { kind: 'icon'; name: string; style: TextStyle }
  | { kind: 'unknown'; text: string; style: TextStyle }
  | { kind: 'break' };

export interface IconLookup {
  resolve(name: string): string | null;
}

export function iconLookup(names: Iterable<string>, aliases: Record<string, string> = {}): IconLookup {
  const map = new Map<string, string>();
  for (const n of names) map.set(n.toLowerCase(), n);
  for (const [alias, target] of Object.entries(aliases)) {
    const t = map.get(target.toLowerCase());
    if (t && !map.has(alias.toLowerCase())) map.set(alias.toLowerCase(), t);
  }
  return { resolve: (name) => map.get(name.trim().toLowerCase()) ?? null };
}

export function parseMarkup(src: string, icons: IconLookup): Token[] {
  const text = src.replace(/\r\n?/g, '\n').replace(/\\n/g, '\n');
  const tokens: Token[] = [];
  const style: TextStyle = { bold: false, italic: false };
  let buf = '';

  const flush = () => {
    if (buf) tokens.push({ kind: 'text', text: buf, style: { ...style } });
    buf = '';
  };

  // A style marker only counts if a partner marker appears later in the same paragraph.
  const hasPartner = (from: number, ch: string) => {
    for (let j = from; j < text.length; j++) {
      const c = text[j];
      if (c === '\n') return false;
      if (c === '\\') j++;
      else if (c === ch) return true;
    }
    return false;
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '\\' && i + 1 < text.length && '*_[\\]'.includes(text[i + 1]!)) {
      buf += text[++i];
    } else if (c === '\n') {
      flush();
      tokens.push({ kind: 'break' });
      style.bold = false;
      style.italic = false;
    } else if (c === '[' && text[i + 1] === '[') {
      buf += '[';
      i++;
    } else if (c === '[') {
      const close = text.indexOf(']', i + 1);
      const nl = text.indexOf('\n', i + 1);
      if (close === -1 || (nl !== -1 && nl < close)) {
        buf += c;
        continue;
      }
      const raw = text.slice(i + 1, close);
      flush();
      const name = icons.resolve(raw);
      tokens.push(name ? { kind: 'icon', name, style: { ...style } } : { kind: 'unknown', text: `[${raw}]`, style: { ...style } });
      i = close;
    } else if ((c === '*' || c === '_') && (c === '*' ? style.bold : style.italic)) {
      flush();
      if (c === '*') style.bold = false;
      else style.italic = false;
    } else if ((c === '*' || c === '_') && hasPartner(i + 1, c)) {
      flush();
      if (c === '*') style.bold = true;
      else style.italic = true;
    } else {
      buf += c;
    }
  }
  flush();
  return tokens;
}

export function escapeMarkup(text: string): string {
  return text.replace(/([\\*_[\]])/g, '\\$1');
}

