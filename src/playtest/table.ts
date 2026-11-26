import { clampToTable, freeSpot, homeSpots, tableBox, type Box, type Point, type Seat } from './layout';

export interface PlaytestConfig {
  handSize: number;
  drawPerTurn: number;
  counters: { name: string; start: number }[];
}

export const DEFAULT_CONFIG: PlaytestConfig = { handSize: 5, drawPerTurn: 1, counters: [{ name: 'Life', start: 20 }] };

export function playtestConfig(raw: unknown): PlaytestConfig {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const int = (v: unknown, d: number, max = 99) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(max, Math.round(v))) : d);
  const counters = Array.isArray(o.counters)
    ? o.counters
        .filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null && typeof (c as { name?: unknown }).name === 'string')
        .map((c) => ({ name: String(c.name), start: typeof c.start === 'number' && Number.isFinite(c.start) ? c.start : 0 }))
    : DEFAULT_CONFIG.counters;
  return { handSize: int(o.handSize, DEFAULT_CONFIG.handSize), drawPerTurn: int(o.drawPerTurn, DEFAULT_CONFIG.drawPerTurn), counters };
}

export interface DeckEntry {
  key: string;
  count: number;
}

export interface PlayerSetup {
  name: string;
  seat: Seat;
  deck: DeckEntry[];
}

export interface Player {
  name: string;
  seat: Seat;
  hand: string[];
  /** Pile ids of this player's own deck and discard pile. */
  deck: string;
  discard: string;
  counters: { name: string; value: number }[];
}

/** A stack of cards lying on the table. `side` is the player it faces (null: upright, shared). */
export interface Pile {
  id: string;
  name: string;
  side: number | null;
  x: number;
  y: number;
  faceDown: boolean;
  /** Top card first. */
  cards: string[];
}

export interface CardInstance {
  uid: string;
  key: string;
  /** The player whose deck it came from (null: a shared deck). */
  owner: number | null;
  /** On the table: the player it faces, which also decides whose untap it follows. */
  side: number;
  faceDown: boolean;
  tapped: boolean;
  marks: number;
  /** Centre on the table. */
  x: number;
  y: number;
}

export type Place = { zone: 'hand'; player: number } | { zone: 'pile'; pile: string } | { zone: 'table' };

export interface TableState {
  box: Box;
  players: Player[];
  piles: Pile[];
  /** Loose cards on the table, bottom of the drawing order first. */
  table: string[];
  cards: Record<string, CardInstance>;
  /** Whose turn it is. */
  current: number;
  turn: number;
  /** Newest first. */
  log: string[];
  /** Random-number state, so shuffles are reproducible in tests. */
  seed: number;
  /** Counter for new card and pile ids. */
  ids: number;
}

type Namer = (key: string) => string;
const plain: Namer = (k) => k;

/** mulberry32: small, fast, good enough for shuffling. Returns [value 0..1, next seed]. */
export function random(seed: number): [number, number] {
  const next = (seed + 0x6d2b79f5) | 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next];
}

function shuffled<T>(list: T[], seed: number): [T[], number] {
  const a = [...list];
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    const [r, n] = random(s);
    s = n;
    const j = Math.floor(r * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return [a, s];
}

const MAX_LOG = 80;

/** With several players at one screen, the log only names cards everyone can see. */
export const secret = (s: TableState) => s.players.length > 1;

function withLog(s: TableState, line: string, actor?: number | null): TableState {
  const who = actor != null && secret(s) ? `${s.players[actor]?.name ?? '?'}: ` : '';
  return { ...s, log: [who + line, ...s.log].slice(0, MAX_LOG) };
}

export const pileById = (s: TableState, id: string) => s.piles.find((p) => p.id === id);

function setPile(s: TableState, id: string, fn: (p: Pile) => Pile): TableState {
  return { ...s, piles: s.piles.map((p) => (p.id === id ? fn(p) : p)) };
}

function setPlayer(s: TableState, i: number, fn: (p: Player) => Player): TableState {
  return { ...s, players: s.players.map((p, j) => (j === i ? fn(p) : p)) };
}

export function placeOf(s: TableState, uid: string): Place | null {
  if (s.table.includes(uid)) return { zone: 'table' };
  const p = s.players.findIndex((pl) => pl.hand.includes(uid));
  if (p >= 0) return { zone: 'hand', player: p };
  const pile = s.piles.find((pl) => pl.cards.includes(uid));
  return pile ? { zone: 'pile', pile: pile.id } : null;
}

export function pileLabel(s: TableState, p: Pile): string {
  const owner = p.side != null && secret(s) && s.players[p.side];
  return owner && (p.id === owner.deck || p.id === owner.discard) ? `${owner.name}'s ${p.name.toLowerCase()}` : p.name;
}

const pileRef = (s: TableState, p: Pile) => ({ Deck: 'the deck', Discard: 'the discard pile' })[pileLabel(s, p)] ?? pileLabel(s, p);

/** Whether every player at the table may see the card's face. */
function isPublic(s: TableState, uid: string): boolean {
  const at = placeOf(s, uid);
  if (!at) return false;
  if (at.zone === 'table') return !s.cards[uid]!.faceDown;
  if (at.zone === 'pile') return !pileById(s, at.pile)!.faceDown;
  return false;
}

function newCards(s: TableState, deck: DeckEntry[], owner: number | null): [TableState, string[]] {
  const cards = { ...s.cards };
  const ids: string[] = [];
  let n = s.ids;
  for (const e of deck) {
    for (let i = 0; i < e.count; i++) {
      const uid = `c${++n}`;
      cards[uid] = { uid, key: e.key, owner, side: owner ?? 0, faceDown: false, tapped: false, marks: 0, x: 0, y: 0 };
      ids.push(uid);
    }
  }
  return [{ ...s, cards, ids: n }, ids];
}

export interface NewPile {
  name: string;
  side: number | null;
  x: number;
  y: number;
  faceDown: boolean;
}

export function addPile(s: TableState, p: NewPile, cards: string[] = []): [TableState, string] {
  const id = `p${s.ids + 1}`;
  return [{ ...s, ids: s.ids + 1, piles: [...s.piles, { ...p, id, cards }] }, id];
}

export function startGame(setup: PlayerSetup[], config: PlaytestConfig, seed: number, card: { w: number; h: number }, name: Namer = plain): TableState {
  const seats = setup.map((p) => p.seat);
  const box = tableBox(seats, card.w, card.h);
  let s: TableState = { box, players: [], piles: [], table: [], cards: {}, current: 0, turn: 1, log: [], seed, ids: 0 };
  setup.forEach((p, i) => {
    const home = homeSpots(p.seat, box, seats);
    let ids: string[];
    [s, ids] = newCards(s, p.deck, i);
    const [order, next] = shuffled(ids, s.seed);
    s = { ...s, seed: next };
    let deck: string, discard: string;
    [s, deck] = addPile(s, { name: 'Deck', side: i, ...home.deck, faceDown: true }, order);
    [s, discard] = addPile(s, { name: 'Discard', side: i, ...home.discard, faceDown: false });
    const counters = config.counters.map((c) => ({ name: c.name, value: c.start }));
    s = { ...s, players: [...s.players, { name: p.name, seat: p.seat, hand: [], deck, discard, counters }] };
  });
  const sizes = s.players.map((p) => `${p.name} ${pileById(s, p.deck)!.cards.length}`);
  s = withLog(s, s.players.length === 1 ? `New game: ${pileById(s, s.players[0]!.deck)!.cards.length} cards shuffled` : `New game: ${sizes.join(', ')} cards`);
  for (let i = 0; i < s.players.length; i++) s = draw(s, i, config.handSize, name);
  return s;
}

export function shufflePile(s: TableState, id: string, actor?: number): TableState {
  const p = pileById(s, id);
  if (!p) return s;
  const [cards, seed] = shuffled(p.cards, s.seed);
  return withLog({ ...setPile(s, id, (x) => ({ ...x, cards })), seed }, `Shuffled ${pileRef(s, p)}`, actor);
}

/** Draws from the top of a pile (default: the player's own deck) into the player's hand. */
export function draw(s: TableState, player: number, count = 1, name: Namer = plain, from?: string): TableState {
  const pl = s.players[player];
  const pile = pl && pileById(s, from ?? pl.deck);
  if (!pl || !pile) return s;
  const n = Math.min(count, pile.cards.length);
  if (n === 0) return withLog(s, count > 0 ? `${from && from !== pl.deck ? pileLabel(s, pile) : 'The deck'} is empty` : 'Drew nothing', player);
  const drawn = pile.cards.slice(0, n);
  const shown = !secret(s) || !pile.faceDown;
  const line = n === 1 ? `Drew ${shown ? name(s.cards[drawn[0]!]!.key) : 'a card'}` : `Drew ${n} cards`;
  const t = setPlayer(
    setPile(s, pile.id, (p) => ({ ...p, cards: p.cards.slice(n) })),
    player,
    (p) => ({ ...p, hand: [...p.hand, ...drawn] }),
  );
  return withLog(t, from && from !== pl.deck ? `${line} from ${pileRef(s, pile)}` : line, player);
}

export interface MoveOptions {
  /** Position in a hand or pile (pile: 0 = top). Default: the end of a hand, the top of a pile. */
  index?: number;
  x?: number;
  y?: number;
  faceDown?: boolean;
  /** On the table: the player the card faces. Default: who moves it there, or where it already faced. */
  side?: number;
}

function placeName(s: TableState, to: Place, index: number, length: number): string {
  if (to.zone === 'table') return 'the table';
  if (to.zone === 'hand') return secret(s) ? `${s.players[to.player]!.name}'s hand` : 'hand';
  const ref = pileRef(s, pileById(s, to.pile)!);
  return length > 1 && index >= length - 1 ? `the bottom of ${ref}` : ref;
}

/** Moves a card. Cards untap when they leave the table; a card taken from a face-down pile stays face down on the table. */
export function moveCard(s: TableState, uid: string, to: Place, actor: number, opts: MoveOptions = {}, name: Namer = plain): TableState {
  const from = placeOf(s, uid);
  const card = s.cards[uid];
  if (!from || !card) return s;
  if (to.zone === 'pile' && !pileById(s, to.pile)) return s;
  if (to.zone === 'hand' && !s.players[to.player]) return s;
  const wasPublic = isPublic(s, uid);
  const fromPile = from.zone === 'pile' ? pileById(s, from.pile)! : null;

  let t: TableState = s;
  if (from.zone === 'table') t = { ...t, table: t.table.filter((u) => u !== uid) };
  else if (from.zone === 'hand') t = setPlayer(t, from.player, (p) => ({ ...p, hand: p.hand.filter((u) => u !== uid) }));
  else t = setPile(t, from.pile, (p) => ({ ...p, cards: p.cards.filter((u) => u !== uid) }));

  const insert = (list: string[], def: number): [string[], number] => {
    const at = Math.max(0, Math.min(list.length, opts.index ?? def));
    const next = [...list];
    next.splice(at, 0, uid);
    return [next, at];
  };
  let index = 0;
  let length = 0;
  if (to.zone === 'table') t = { ...t, table: [...t.table, uid] };
  else if (to.zone === 'hand') {
    t = setPlayer(t, to.player, (p) => {
      const [hand, at] = insert(p.hand, p.hand.length);
      index = at;
      length = hand.length;
      return { ...p, hand };
    });
  } else {
    t = setPile(t, to.pile, (p) => {
      const [cards, at] = insert(p.cards, 0);
      index = at;
      length = cards.length;
      return { ...p, cards };
    });
  }

  const onTable = to.zone === 'table';
  const stays = onTable && from.zone === 'table';
  const pos = onTable ? clampToTable(t.box, { x: opts.x ?? card.x, y: opts.y ?? card.y }) : { x: card.x, y: card.y };
  const moved: CardInstance = {
    ...card,
    tapped: stays ? card.tapped : false,
    marks: stays ? card.marks : 0,
    faceDown: onTable ? (opts.faceDown ?? (stays ? card.faceDown : fromPile ? fromPile.faceDown : false)) : false,
    side: onTable ? (opts.side ?? (stays ? card.side : actor)) : card.side,
    ...pos,
  };
  t = { ...t, cards: { ...t.cards, [uid]: moved } };
  const same = from.zone === to.zone && (from.zone === 'table' || (from.zone === 'hand' && to.zone === 'hand' && from.player === to.player) || (from.zone === 'pile' && to.zone === 'pile' && from.pile === to.pile));
  if (same) return t;
  const nowPublic = isPublic(t, uid);
  const faceDownHere = onTable && moved.faceDown;
  const known = wasPublic || nowPublic || (!secret(s) && !faceDownHere);
  const shown = known ? name(card.key) : faceDownHere ? 'a face-down card' : 'a card';
  return withLog(t, `${shown} → ${placeName(t, to, index, length)}`, actor);
}

function updateCard(s: TableState, uid: string, fn: (c: CardInstance) => CardInstance): TableState {
  const c = s.cards[uid];
  return c ? { ...s, cards: { ...s.cards, [uid]: fn(c) } } : s;
}

export const toggleTap = (s: TableState, uid: string) => updateCard(s, uid, (c) => ({ ...c, tapped: !c.tapped }));
export const toggleFaceDown = (s: TableState, uid: string) => updateCard(s, uid, (c) => ({ ...c, faceDown: !c.faceDown }));
export const addMarks = (s: TableState, uid: string, d: number) => updateCard(s, uid, (c) => ({ ...c, marks: Math.max(0, c.marks + d) }));
export const turnCardTo = (s: TableState, uid: string, player: number) => updateCard(s, uid, (c) => ({ ...c, side: player }));

/** Untaps the cards on the table that face this player. */
export function untapAll(s: TableState, player: number): TableState {
  const cards = { ...s.cards };
  for (const uid of s.table) if (cards[uid]!.side === player) cards[uid] = { ...cards[uid]!, tapped: false };
  return { ...s, cards };
}

export function mulligan(s: TableState, player: number, size?: number, name?: Namer): TableState {
  const pl = s.players[player];
  if (!pl) return s;
  const n = size ?? pl.hand.length;
  let t = setPile(s, pl.deck, (p) => ({ ...p, cards: [...p.cards, ...pl.hand] }));
  t = setPlayer(t, player, (p) => ({ ...p, hand: [] }));
  t = shufflePile(t, pl.deck, player);
  t = draw(t, player, n, name);
  return withLog(t, `Mulligan to ${Math.min(n, t.players[player]!.hand.length)}`, player);
}

/** Passes the turn to the next player, who untaps and draws. */
export function nextTurn(s: TableState, config: PlaytestConfig, name?: Namer): TableState {
  const current = (s.current + 1) % s.players.length;
  let t = untapAll({ ...s, current, turn: s.turn + 1 }, current);
  t = withLog(t, secret(t) ? `— Turn ${t.turn}: ${t.players[current]!.name} —` : `— Turn ${t.turn} —`);
  return config.drawPerTurn > 0 ? draw(t, current, config.drawPerTurn, name) : t;
}

/** The top card of the player's deck goes to their discard pile. */
export function mill(s: TableState, player: number, name: Namer = plain): TableState {
  const pl = s.players[player];
  const top = pl && pileById(s, pl.deck)?.cards[0];
  if (!pl || !top) return withLog(s, 'The deck is empty', player);
  const t = moveCard(s, top, { zone: 'pile', pile: pl.discard }, player);
  return withLog({ ...t, log: t.log.slice(1) }, `Milled ${name(s.cards[top]!.key)}`, player);
}

export function setCounter(s: TableState, player: number, index: number, value: number): TableState {
  const c = s.players[player]?.counters[index];
  if (!c || !Number.isFinite(value)) return s;
  return setPlayer(s, player, (p) => ({ ...p, counters: p.counters.map((x, i) => (i === index ? { ...x, value } : x)) }));
}

export function roll(s: TableState, sides: number, actor?: number): TableState {
  const [r, seed] = random(s.seed);
  const v = 1 + Math.floor(r * sides);
  return withLog({ ...s, seed }, sides === 2 ? `Coin flip: ${v === 1 ? 'heads' : 'tails'}` : `Rolled a d${sides}: ${v}`, actor);
}

export const movePile = (s: TableState, id: string, p: Point) => setPile(s, id, (x) => ({ ...x, ...clampToTable(s.box, p) }));
export const turnPileTo = (s: TableState, id: string, player: number | null) => setPile(s, id, (x) => ({ ...x, side: player }));
export const renamePile = (s: TableState, id: string, name: string) => (name.trim() ? setPile(s, id, (x) => ({ ...x, name: name.trim() })) : s);

/** Turns the whole pile over, so its bottom card is now on top. */
export function flipPile(s: TableState, id: string, actor?: number): TableState {
  const p = pileById(s, id);
  if (!p) return s;
  const t = setPile(s, id, (x) => ({ ...x, faceDown: !x.faceDown, cards: [...x.cards].reverse() }));
  return withLog(t, `Turned ${pileRef(s, p)} ${p.faceDown ? 'face up' : 'face down'}`, actor);
}

/** A player's own deck and discard pile stay; other piles can go once they are empty. */
export function canRemovePile(s: TableState, id: string): boolean {
  const p = pileById(s, id);
  return !!p && p.cards.length === 0 && !s.players.some((pl) => pl.deck === id || pl.discard === id);
}

export const removePile = (s: TableState, id: string) => (canRemovePile(s, id) ? { ...s, piles: s.piles.filter((p) => p.id !== id) } : s);

/** Puts every card of one pile on top of another, then shuffles that pile. */
export function shuffleInto(s: TableState, from: string, into: string, actor?: number): TableState {
  const a = pileById(s, from);
  const b = pileById(s, into);
  if (!a || !b || a === b) return s;
  let t = setPile(s, into, (p) => ({ ...p, cards: [...a.cards, ...p.cards] }));
  t = setPile(t, from, (p) => ({ ...p, cards: [] }));
  const [cards, seed] = shuffled(pileById(t, into)!.cards, t.seed);
  t = { ...setPile(t, into, (p) => ({ ...p, cards })), seed };
  return withLog(t, `Shuffled ${pileRef(s, a)} (${a.cards.length}) into ${pileRef(s, b)}`, actor);
}

/** Deals one card from a pile to every player, starting with the player whose turn it is. */
export function dealEach(s: TableState, id: string, name?: Namer): TableState {
  let t = s;
  for (let k = 0; k < s.players.length; k++) t = draw(t, (s.current + k) % s.players.length, 1, name, id);
  return t;
}

/** Shuffles a deck into a new face-down pile on the table; its cards belong to no player. */
export function putDeck(s: TableState, deck: DeckEntry[], pile: Omit<NewPile, 'faceDown'>, actor?: number): TableState {
  const [t, ids] = newCards(s, deck, null);
  const [order, seed] = shuffled(ids, t.seed);
  const [u] = addPile({ ...t, seed }, { ...pile, faceDown: true }, order);
  return withLog(u, `Put ${pile.name} (${ids.length} cards) on the table`, actor);
}

/** Starts a new face-up pile from a card on the table. */
export function pileFromCard(s: TableState, uid: string, name: string, actor: number): TableState {
  const c = s.cards[uid];
  if (!c || !s.table.includes(uid)) return s;
  const [t, id] = addPile(s, { name, side: c.side, x: c.x, y: c.y, faceDown: c.faceDown });
  return moveCard(t, uid, { zone: 'pile', pile: id }, actor);
}

/** Where a card played by this player lands when no spot is given. */
export function openSpot(s: TableState, player: number): Point {
  const seats = s.players.map((p) => p.seat);
  const taken = [...s.table.map((u) => s.cards[u]!), ...s.piles];
  return freeSpot(s.players[player]!.seat, s.box, seats, taken);
}

export function playCard(s: TableState, uid: string, player: number, opts: MoveOptions = {}, name?: Namer): TableState {
  return moveCard(s, uid, { zone: 'table' }, player, { faceDown: false, ...openSpot(s, player), ...opts }, name);
}
