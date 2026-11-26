
const OPENS_AFTER = /[\s([{—–/-]/;
const WORDISH = /[\p{L}\p{N}]/u;

export function smartPunctuation(text: string): string {
  let out = '';
  let inIcon = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    const prev = out.length ? out[out.length - 1]! : '';
    const next = text[i + 1] ?? '';

    // `[[` is a literal bracket; `[name]` is an icon code and stays as typed.
    if (c === '[' && next === '[') {
      out += '[[';
      i++;
      continue;
    }
    if (c === '[') inIcon = true;
    if (c === ']') inIcon = false;
    if (inIcon) {
      out += c;
      continue;
    }

    if (c === '.' && text.startsWith('...', i)) {
      out += '…';
      i += 2;
    } else if (c === '-' && text.startsWith('---', i)) {
      out += '—';
      i += 2;
    } else if (c === '-' && next === '-') {
      out += '–';
      i += 1;
    } else if (c === '"') {
      out += prev === '' || OPENS_AFTER.test(prev) || prev === '‘' ? '“' : '”';
    } else if (c === "'") {
      // Between letters it is an apostrophe (don't, Kai's); after a space it opens a quote.
      if (WORDISH.test(prev) && WORDISH.test(next)) out += '’';
      else out += prev === '' || OPENS_AFTER.test(prev) || prev === '“' ? '‘' : '’';
    } else {
      out += c;
    }
  }
  return out;
}
