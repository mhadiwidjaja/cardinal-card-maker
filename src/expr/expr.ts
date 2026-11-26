/**
 * A small, safe expression language for templates (no eval).
 *
 *   cost + 1                      arithmetic: + - * / %
 *   rarity == 'Rare'              comparison: == != < <= > >=  (== ignores case)
 *   flavor != '' and not foil     logic: and or not  (also && || !)
 *   if(attack > 5, 'big', 'small')
 *   'ATK ' + attack               + joins text when either side isn't a number
 *   set.code, game.name, var.x    dotted names are looked up as-is
 *   field('my-field')             fields whose id contains '-'
 *
 * Card values are text (from CSV). Text that looks like a number acts as a
 * number in arithmetic and comparisons. Empty text, '0', 'false' and 'no' are
 * false; everything else is true.
 */

export type Value = string | number | boolean;
export type Resolver = (name: string) => Value | undefined;

export type Node =
  | { k: 'lit'; v: Value }
  | { k: 'name'; name: string }
  | { k: 'unary'; op: '-' | 'not'; arg: Node }
  | { k: 'bin'; op: string; a: Node; b: Node }
  | { k: 'call'; fn: string; args: Node[] };

export class ExprError extends Error {
  constructor(message: string, public readonly pos?: number) {
    super(message);
    this.name = 'ExprError';
  }
}

type Tok = { t: 'num'; v: number; p: number } | { t: 'str'; v: string; p: number } | { t: 'id'; v: string; p: number } | { t: 'op'; v: string; p: number };

const OPS = ['==', '!=', '<=', '>=', '&&', '||', '+', '-', '*', '/', '%', '<', '>', '(', ')', ',', '!', '='];

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
    } else if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?|^[0-9]+\.?/.exec(src.slice(i))!;
      toks.push({ t: 'num', v: Number(m[0]), p: i });
      i += m[0].length;
    } else if (c === "'" || c === '"') {
      let j = i + 1;
      let s = '';
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\' && j + 1 < src.length) {
          const n = src[j + 1]!;
          s += n === 'n' ? '\n' : n;
          j += 2;
        } else s += src[j++];
      }
      if (j >= src.length) throw new ExprError('Text is missing its closing quote', i);
      toks.push({ t: 'str', v: s, p: i });
      i = j + 1;
    } else if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/.exec(src.slice(i))!;
      toks.push({ t: 'id', v: m[0], p: i });
      i += m[0].length;
    } else {
      const op = OPS.find((o) => src.startsWith(o, i));
      if (!op) throw new ExprError(`Unexpected character "${c}"`, i);
      toks.push({ t: 'op', v: op, p: i });
      i += op.length;
    }
  }
  return toks;
}

const BINARY: Record<string, number> = {
  or: 1, '||': 1,
  and: 2, '&&': 2,
  '==': 3, '!=': 3, '=': 3,
  '<': 4, '<=': 4, '>': 4, '>=': 4,
  '+': 5, '-': 5,
  '*': 6, '/': 6, '%': 6,
};
const CANON: Record<string, string> = { '||': 'or', '&&': 'and', '=': '==' };

export function parse(src: string): Node {
  const toks = tokenize(src);
  let pos = 0;
  const peek = () => toks[pos];
  const at = () => peek()?.p ?? src.length;

  function opOf(tok: Tok | undefined): string | undefined {
    if (!tok) return undefined;
    if (tok.t === 'op' && tok.v in BINARY) return tok.v;
    if (tok.t === 'id' && (tok.v === 'and' || tok.v === 'or')) return tok.v;
    return undefined;
  }

  function expect(v: string) {
    const tok = peek();
    if (!tok || tok.t !== 'op' || tok.v !== v) throw new ExprError(`Expected "${v}"`, at());
    pos++;
  }

  function primary(): Node {
    const tok = peek();
    if (!tok) throw new ExprError('Expression ends too early', src.length);
    pos++;
    if (tok.t === 'num') return { k: 'lit', v: tok.v };
    if (tok.t === 'str') return { k: 'lit', v: tok.v };
    if (tok.t === 'op') {
      if (tok.v === '(') {
        const e = expr(0);
        expect(')');
        return e;
      }
      if (tok.v === '-') return { k: 'unary', op: '-', arg: expr(7) };
      if (tok.v === '!') return { k: 'unary', op: 'not', arg: notArg() };
      throw new ExprError(`Unexpected "${tok.v}"`, tok.p);
    }
    if (tok.v === 'true') return { k: 'lit', v: true };
    if (tok.v === 'false') return { k: 'lit', v: false };
    if (tok.v === 'not') return { k: 'unary', op: 'not', arg: notArg() };
    const next = peek();
    if (next?.t === 'op' && next.v === '(') {
      pos++;
      const args: Node[] = [];
      if (!(peek()?.t === 'op' && peek()!.v === ')')) {
        for (;;) {
          args.push(expr(0));
          const sep = peek();
          if (sep?.t === 'op' && sep.v === ',') pos++;
          else break;
        }
      }
      expect(')');
      const fn = tok.v.toLowerCase();
      if (!(fn in FUNCTIONS)) throw new ExprError(`Unknown function "${tok.v}"`, tok.p);
      return { k: 'call', fn, args };
    }
    return { k: 'name', name: tok.v };
  }

  // "not a == b" means "not (a == b)", as people expect; "not a and b" means "(not a) and b".
  function notArg(): Node {
    return expr(3);
  }

  function expr(minPrec: number): Node {
    let left = primary();
    for (;;) {
      const op = opOf(peek());
      if (!op) break;
      const prec = BINARY[op]!;
      if (prec < minPrec) break;
      pos++;
      const right = expr(prec + 1);
      left = { k: 'bin', op: CANON[op] ?? op, a: left, b: right };
    }
    return left;
  }

  if (toks.length === 0) return { k: 'lit', v: '' };
  const node = expr(0);
  if (pos < toks.length) throw new ExprError(`Unexpected "${String(toks[pos]!.v)}"`, toks[pos]!.p);
  return node;
}

export function toNumber(v: Value): number | null {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const s = v.trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function toBool(v: Value): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  const s = v.trim().toLowerCase();
  return !(s === '' || s === '0' || s === 'false' || s === 'no' || s === 'n');
}

export function toText(v: Value): string {
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6);
  return String(v);
}

export function splitList(v: Value): string[] {
  return toText(v)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

function compare(a: Value, b: Value): number {
  const x = toNumber(a);
  const y = toNumber(b);
  if (x !== null && y !== null) return x - y;
  return toText(a).toLowerCase().localeCompare(toText(b).toLowerCase());
}

function equals(a: Value, b: Value): boolean {
  const x = toNumber(a);
  const y = toNumber(b);
  if (x !== null && y !== null) return x === y;
  if (typeof a === 'boolean' || typeof b === 'boolean') return toBool(a) === toBool(b);
  return toText(a).toLowerCase() === toText(b).toLowerCase();
}

function num(v: Value, what: string): number {
  const n = toNumber(v);
  if (n === null) throw new ExprError(`${what}: "${toText(v)}" is not a number`);
  return n;
}

type Fn = { min: number; max: number; run: (args: Value[]) => Value };
const FUNCTIONS: Record<string, Fn> = {
  if: { min: 2, max: 3, run: () => '' },
  field: { min: 1, max: 1, run: () => '' },
  has: { min: 1, max: 1, run: () => '' },
  lower: { min: 1, max: 1, run: ([a]) => toText(a!).toLowerCase() },
  upper: { min: 1, max: 1, run: ([a]) => toText(a!).toUpperCase() },
  trim: { min: 1, max: 1, run: ([a]) => toText(a!).trim() },
  len: { min: 1, max: 1, run: ([a]) => toText(a!).length },
  count: { min: 1, max: 1, run: ([a]) => splitList(a!).length },
  contains: {
    min: 2,
    max: 2,
    run: ([list, item]) => {
      const needle = toText(item!).trim().toLowerCase();
      const items = splitList(list!).map((s) => s.toLowerCase());
      return items.includes(needle) || (items.length <= 1 && toText(list!).toLowerCase().includes(needle));
    },
  },
  item: { min: 2, max: 2, run: ([list, i]) => splitList(list!)[num(i!, 'item') - 1] ?? '' },
  number: { min: 1, max: 2, run: ([a, d]) => toNumber(a!) ?? (d === undefined ? 0 : d) },
  round: { min: 1, max: 1, run: ([a]) => Math.round(num(a!, 'round')) },
  floor: { min: 1, max: 1, run: ([a]) => Math.floor(num(a!, 'floor')) },
  ceil: { min: 1, max: 1, run: ([a]) => Math.ceil(num(a!, 'ceil')) },
  abs: { min: 1, max: 1, run: ([a]) => Math.abs(num(a!, 'abs')) },
  min: { min: 1, max: 99, run: (args) => Math.min(...args.map((a) => num(a, 'min'))) },
  max: { min: 1, max: 99, run: (args) => Math.max(...args.map((a) => num(a, 'max'))) },
  pad: {
    min: 2,
    max: 2,
    run: ([a, w]) => {
      const n = toNumber(a!);
      const s = n === null ? toText(a!) : String(Math.trunc(n));
      return s.padStart(num(w!, 'pad'), '0');
    },
  },
  repeat: { min: 2, max: 2, run: ([a, n]) => toText(a!).repeat(Math.max(0, Math.min(100, num(n!, 'repeat')))) },
  replace: { min: 3, max: 3, run: ([a, f, r]) => toText(a!).split(toText(f!)).join(toText(r!)) },
};

export function evaluate(node: Node, resolve: Resolver): Value {
  switch (node.k) {
    case 'lit':
      return node.v;
    case 'name':
      return resolve(node.name) ?? '';
    case 'unary': {
      const v = evaluate(node.arg, resolve);
      return node.op === 'not' ? !toBool(v) : -num(v, 'minus');
    }
    case 'bin': {
      if (node.op === 'and') return toBool(evaluate(node.a, resolve)) && toBool(evaluate(node.b, resolve));
      if (node.op === 'or') {
        const a = evaluate(node.a, resolve);
        return toBool(a) ? a : evaluate(node.b, resolve);
      }
      const a = evaluate(node.a, resolve);
      const b = evaluate(node.b, resolve);
      switch (node.op) {
        case '==': return equals(a, b);
        case '!=': return !equals(a, b);
        case '<': return compare(a, b) < 0;
        case '<=': return compare(a, b) <= 0;
        case '>': return compare(a, b) > 0;
        case '>=': return compare(a, b) >= 0;
        case '+': {
          const x = toNumber(a);
          const y = toNumber(b);
          return x !== null && y !== null ? x + y : toText(a) + toText(b);
        }
        case '-': return num(a, 'minus') - num(b, 'minus');
        case '*': return num(a, 'times') * num(b, 'times');
        case '/': {
          const d = num(b, 'divide');
          if (d === 0) throw new ExprError('Division by zero');
          return num(a, 'divide') / d;
        }
        case '%': return num(a, 'remainder') % num(b, 'remainder');
      }
      throw new ExprError(`Unknown operator ${node.op}`);
    }
    case 'call': {
      const fn = FUNCTIONS[node.fn]!;
      if (node.args.length < fn.min || node.args.length > fn.max) {
        throw new ExprError(`${node.fn}() takes ${fn.min === fn.max ? fn.min : `${fn.min} to ${fn.max}`} argument${fn.max > 1 ? 's' : ''}`);
      }
      if (node.fn === 'if') {
        return toBool(evaluate(node.args[0]!, resolve)) ? evaluate(node.args[1]!, resolve) : node.args[2] ? evaluate(node.args[2], resolve) : '';
      }
      if (node.fn === 'field') return resolve(toText(evaluate(node.args[0]!, resolve))) ?? '';
      if (node.fn === 'has') return toText(evaluate(node.args[0]!, resolve)).trim() !== '';
      return fn.run(node.args.map((a) => evaluate(a, resolve)));
    }
  }
}

const cache = new Map<string, Node | ExprError>();

export function compile(src: string): Node {
  let hit = cache.get(src);
  if (!hit) {
    try {
      hit = parse(src);
    } catch (e) {
      if (!(e instanceof ExprError)) throw e;
      hit = e;
    }
    if (cache.size > 5000) cache.clear();
    cache.set(src, hit);
  }
  if (hit instanceof ExprError) throw hit;
  return hit;
}

export function run(src: string, resolve: Resolver): Value {
  return evaluate(compile(src), resolve);
}

export function interpolate(text: string, resolve: Resolver): string {
  return splitInterpolation(text)
    .map((part) => (typeof part === 'string' ? part : toText(run(part.expr, resolve))))
    .join('');
}

export type InterpPart = string | { expr: string };

export function splitInterpolation(text: string): InterpPart[] {
  const parts: InterpPart[] = [];
  let buf = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (c === '{' && text[i + 1] === '{') {
      buf += '{';
      i += 2;
    } else if (c === '}' && text[i + 1] === '}') {
      buf += '}';
      i += 2;
    } else if (c === '{') {
      let j = i + 1;
      let quote: string | null = null;
      while (j < text.length) {
        const d = text[j]!;
        if (quote) {
          if (d === '\\') j++;
          else if (d === quote) quote = null;
        } else if (d === "'" || d === '"') quote = d;
        else if (d === '}') break;
        j++;
      }
      if (j >= text.length) throw new ExprError('A "{" has no matching "}"', i);
      if (buf) parts.push(buf);
      buf = '';
      parts.push({ expr: text.slice(i + 1, j) });
      i = j + 1;
    } else {
      buf += c;
      i++;
    }
  }
  if (buf) parts.push(buf);
  return parts;
}
