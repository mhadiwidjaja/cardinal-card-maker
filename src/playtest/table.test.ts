import { describe, expect, it } from 'vitest';
import { demoWorkspaceFs } from '../model/demo';
import { loadWorkspace } from '../model/load';
import { MemoryFs } from '../fs/memoryFs';
import { deckSize, deckText, loadDecks, parseDeck, saveDeck, setDeck } from './decks';
import { defaultSeats, freeSpot, homeSpots, homeZone, SEATS, seatPoint, tableBox, type Point } from './layout';
import {
  addMarks,
  canRemovePile,
  DEFAULT_CONFIG,
  dealEach,
  draw,
  flipPile,
  mill,
  moveCard,
  mulligan,
  nextTurn,
  pileById,
  pileFromCard,
  placeOf,
  playCard,
  playtestConfig,
  putDeck,
  random,
  removePile,
  roll,
  setCounter,
  shuffleInto,
  shufflePile,
  startGame,
  toggleTap,
  type PlayerSetup,
  type TableState,
} from './table';

const deck = [
  { key: 's/a', count: 3 },
  { key: 's/b', count: 4 },
  { key: 's/c', count: 3 },
];
const cfg = { handSize: 5, drawPerTurn: 1, counters: [{ name: 'Life', start: 20 }] };
const card = { w: 100, h: 140 };
const solo: PlayerSetup[] = [{ name: 'Ana', seat: 'south', deck }];
const duo: PlayerSetup[] = [
  { name: 'Ana', seat: 'south', deck },
  { name: 'Bea', seat: 'north', deck },
];
const total = (s: TableState) => s.table.length + s.players.reduce((n, p) => n + p.hand.length, 0) + s.piles.reduce((n, p) => n + p.cards.length, 0);
const deckOf = (s: TableState, i = 0) => pileById(s, s.players[i]!.deck)!;
const discardOf = (s: TableState, i = 0) => pileById(s, s.players[i]!.discard)!;

describe('playtest table', () => {
  it('starts with a shuffled deck and an opening hand on the table', () => {
    const s = startGame(solo, cfg, 42, card);
    expect(s.players[0]!.hand).toHaveLength(5);
    expect(deckOf(s).cards).toHaveLength(5);
    expect(deckOf(s).faceDown).toBe(true);
    expect(discardOf(s).faceDown).toBe(false);
    expect(total(s)).toBe(10);
    expect(s.players[0]!.counters).toEqual([{ name: 'Life', value: 20 }]);
    expect(s.turn).toBe(1);
  });

  it('gives every player their own deck, discard pile, hand and counters', () => {
    const s = startGame(duo, cfg, 42, card);
    expect(s.players.map((p) => p.hand.length)).toEqual([5, 5]);
    expect(s.piles).toHaveLength(4);
    expect(total(s)).toBe(20);
    for (const uid of s.players[1]!.hand) expect(s.cards[uid]!.owner).toBe(1);
    expect(deckOf(s, 1).side).toBe(1);
    expect(deckOf(s, 0).y).toBeGreaterThan(s.box.h / 2);
    expect(deckOf(s, 1).y).toBeLessThan(s.box.h / 2);
  });

  it('shuffles the same way for the same seed, differently for another', () => {
    const a = deckOf(startGame(solo, cfg, 1, card)).cards;
    expect(deckOf(startGame(solo, cfg, 1, card)).cards).toEqual(a);
    const none = { ...cfg, handSize: 0 };
    expect(deckOf(startGame(solo, none, 2, card)).cards).not.toEqual(deckOf(startGame(solo, none, 3, card)).cards);
  });

  it('random() stays in 0..1', () => {
    let s = 7;
    for (let i = 0; i < 1000; i++) {
      const [v, n] = random(s);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      s = n;
    }
  });

  it('draws from the top and stops at an empty deck', () => {
    let s = startGame(solo, { ...cfg, handSize: 0 }, 5, card);
    const top = deckOf(s).cards[0];
    s = draw(s, 0, 1);
    expect(s.players[0]!.hand).toEqual([top]);
    s = draw(s, 0, 50);
    expect(s.players[0]!.hand).toHaveLength(10);
    expect(deckOf(s).cards).toHaveLength(0);
    expect(draw(s, 0, 1).log[0]).toBe('The deck is empty');
  });

  it('keeps drawn cards out of the log when several players share the screen', () => {
    const one = draw(startGame(solo, { ...cfg, handSize: 0 }, 5, card), 0, 1, (k) => `card ${k}`);
    expect(one.log[0]).toMatch(/^Drew card s\//);
    const two = draw(startGame(duo, { ...cfg, handSize: 0 }, 5, card), 1, 1, (k) => `card ${k}`);
    expect(two.log[0]).toBe('Bea: Drew a card');
    const uid = two.players[1]!.hand[0]!;
    expect(playCard(two, uid, 1, {}, (k) => `card ${k}`).log[0]).toMatch(/^Bea: card s\/. → the table$/);
    expect(playCard(two, uid, 1, { faceDown: true }).log[0]).toBe('Bea: a face-down card → the table');
  });

  it('plays a card in front of its player, facing them, and finds the next open spot', () => {
    let s = startGame(duo, cfg, 9, card);
    const [a, b] = s.players[1]!.hand as [string, string];
    s = playCard(s, a, 1);
    s = playCard(s, b, 1);
    expect(placeOf(s, a)).toEqual({ zone: 'table' });
    expect(s.cards[a]).toMatchObject({ side: 1, faceDown: false });
    expect(s.cards[a]!.y).toBeLessThan(s.box.h / 2);
    expect(Math.hypot(s.cards[a]!.x - s.cards[b]!.x, s.cards[a]!.y - s.cards[b]!.y)).toBeGreaterThan(100);
  });

  it('moves cards between hands, the table and piles, resetting tapped and marks off the table', () => {
    let s = startGame(solo, cfg, 9, card);
    const uid = s.players[0]!.hand[0]!;
    s = moveCard(s, uid, { zone: 'table' }, 0, { x: 300, y: 250 });
    expect(s.cards[uid]).toMatchObject({ x: 300, y: 250 });
    s = addMarks(toggleTap(s, uid), uid, 2);
    expect(s.cards[uid]).toMatchObject({ tapped: true, marks: 2 });
    s = moveCard(s, uid, { zone: 'pile', pile: s.players[0]!.discard }, 0);
    expect(s.cards[uid]).toMatchObject({ tapped: false, marks: 0 });
    expect(discardOf(s).cards).toEqual([uid]);
    expect(total(s)).toBe(10);
  });

  it('keeps a card taken from a face-down pile face down on the table', () => {
    let s = startGame(solo, cfg, 9, card);
    const top = deckOf(s).cards[0]!;
    s = moveCard(s, top, { zone: 'table' }, 0, { x: 200, y: 200 });
    expect(s.cards[top]!.faceDown).toBe(true);
    expect(s.log[0]).toBe('a face-down card → the table');
  });

  it('puts cards on top of a pile by default and at the bottom on request', () => {
    let s = startGame(solo, cfg, 9, card);
    const [a, b] = s.players[0]!.hand as [string, string];
    const to = { zone: 'pile' as const, pile: s.players[0]!.deck };
    s = moveCard(s, a, to, 0);
    expect(deckOf(s).cards[0]).toBe(a);
    s = moveCard(s, b, to, 0, { index: Infinity });
    expect(deckOf(s).cards.at(-1)).toBe(b);
    expect(s.log[0]).toMatch(/bottom of the deck$/);
  });

  it('reorders within a hand', () => {
    let s = startGame(solo, cfg, 9, card);
    const last = s.players[0]!.hand[4]!;
    s = moveCard(s, last, { zone: 'hand', player: 0 }, 0, { index: 0 });
    expect(s.players[0]!.hand[0]).toBe(last);
    expect(s.players[0]!.hand).toHaveLength(5);
  });

  it('gives a card to another player', () => {
    let s = startGame(duo, cfg, 9, card);
    const uid = s.players[0]!.hand[0]!;
    s = moveCard(s, uid, { zone: 'hand', player: 1 }, 0);
    expect(s.players[1]!.hand).toHaveLength(6);
    expect(s.log[0]).toBe("Ana: a card → Bea's hand");
  });

  it('mulligans to the same hand size and keeps every card', () => {
    const s = mulligan(startGame(solo, cfg, 3, card), 0);
    expect(s.players[0]!.hand).toHaveLength(5);
    expect(total(s)).toBe(10);
    expect(mulligan(s, 0, 4).players[0]!.hand).toHaveLength(4);
  });

  it('passes the turn round the table; the next player untaps their own cards and draws', () => {
    let s = startGame(duo, cfg, 3, card);
    const mine = s.players[0]!.hand[0]!;
    const theirs = s.players[1]!.hand[0]!;
    s = toggleTap(playCard(s, mine, 0), mine);
    s = toggleTap(playCard(s, theirs, 1), theirs);
    s = nextTurn(s, cfg);
    expect(s).toMatchObject({ current: 1, turn: 2 });
    expect(s.cards[theirs]!.tapped).toBe(false);
    expect(s.cards[mine]!.tapped).toBe(true);
    expect(s.players[1]!.hand).toHaveLength(5);
    expect(s.log).toContain('— Turn 2: Bea —');
    expect(nextTurn(s, cfg).current).toBe(0);
  });

  it('mills, rolls and sets counters per player', () => {
    let s = startGame(duo, cfg, 3, card);
    const top = deckOf(s, 1).cards[0]!;
    s = mill(s, 1, (k) => `card ${k}`);
    expect(discardOf(s, 1).cards).toEqual([top]);
    expect(s.log[0]).toMatch(/^Bea: Milled card s\//);
    s = roll(s, 6, 0);
    expect(s.log[0]).toMatch(/^Ana: Rolled a d6: [1-6]$/);
    s = setCounter(s, 1, 0, 17);
    expect(s.players.map((p) => p.counters[0]!.value)).toEqual([20, 17]);
    expect([...shufflePile(s, s.players[0]!.deck).piles[0]!.cards].sort()).toEqual([...deckOf(s).cards].sort());
  });

  it('flips a pile over, shuffles one pile into another and deals from a shared deck', () => {
    let s = startGame(duo, cfg, 3, card);
    s = mill(mill(s, 0), 0);
    const [top, next] = discardOf(s).cards as [string, string];
    s = flipPile(s, s.players[0]!.discard);
    expect(discardOf(s)).toMatchObject({ faceDown: true, cards: [next, top] });
    s = shuffleInto(s, s.players[0]!.discard, s.players[0]!.deck);
    expect(discardOf(s).cards).toHaveLength(0);
    expect(deckOf(s).cards).toHaveLength(5);

    s = putDeck(s, [{ key: 's/m', count: 4 }], { name: 'Market', side: null, x: 500, y: 400 });
    const market = s.piles.at(-1)!;
    expect(market).toMatchObject({ name: 'Market', faceDown: true, x: 500, y: 400 });
    s = dealEach(s, market.id);
    expect(s.players.map((p) => p.hand.length)).toEqual([6, 6]);
    expect(pileById(s, market.id)!.cards).toHaveLength(2);
    expect(s.cards[s.players[1]!.hand.at(-1)!]!.owner).toBeNull();
    expect(total(s)).toBe(24);
  });

  it('starts a pile from a table card and removes only empty extra piles', () => {
    let s = startGame(solo, cfg, 3, card);
    const uid = s.players[0]!.hand[0]!;
    s = playCard(s, uid, 0);
    s = pileFromCard(s, uid, 'Exile', 0);
    const pile = s.piles.at(-1)!;
    expect(pile.cards).toEqual([uid]);
    expect(canRemovePile(s, pile.id)).toBe(false);
    s = moveCard(s, uid, { zone: 'hand', player: 0 }, 0);
    expect(removePile(s, pile.id).piles).toHaveLength(2);
    expect(canRemovePile(s, s.players[0]!.discard)).toBe(false);
  });

  it('reads the playtest settings leniently', () => {
    expect(playtestConfig(undefined)).toEqual(DEFAULT_CONFIG);
    expect(playtestConfig({ handSize: 7.4, drawPerTurn: -2, counters: [{ name: 'Mana', start: 0 }, 'junk'] })).toEqual({
      handSize: 7,
      drawPerTurn: 0,
      counters: [{ name: 'Mana', start: 0 }],
    });
  });
});

describe('table layout', () => {
  it('sizes the table for the seats in use', () => {
    const one = tableBox(['south'], 100, 140);
    const two = tableBox(['south', 'north'], 100, 140);
    const four = tableBox(SEATS, 100, 140);
    expect(two.h).toBeGreaterThan(one.h);
    expect(two.w).toBeGreaterThan(two.h);
    expect(four.w).toBeGreaterThan(one.w);
    expect(four.h).toBe(two.h);
  });

  it('maps each seat frame to the right edge', () => {
    const b = tableBox(SEATS, 100, 140);
    expect(seatPoint('south', 0, 0, b)).toEqual({ x: b.w / 2, y: b.h });
    expect(seatPoint('north', 10, 0, b).x).toBeLessThan(b.w / 2);
    expect(seatPoint('west', 0, 5, b)).toEqual({ x: 5, y: b.h / 2 });
    expect(seatPoint('east', 10, 0, b).y).toBeLessThan(b.h / 2);
  });

  it('keeps every home strip and its piles on the table, without overlapping another', () => {
    const b = tableBox(SEATS, 100, 140);
    const zones = SEATS.map((s) => homeZone(s, b, SEATS));
    for (const z of zones) {
      expect(z.x).toBeGreaterThanOrEqual(0);
      expect(z.y).toBeGreaterThanOrEqual(0);
      expect(z.x + z.w).toBeLessThanOrEqual(b.w);
      expect(z.y + z.h).toBeLessThanOrEqual(b.h);
    }
    for (let i = 0; i < 4; i++)
      for (let j = i + 1; j < 4; j++) {
        const [a, c] = [zones[i]!, zones[j]!];
        expect(a.x + a.w <= c.x || c.x + c.w <= a.x || a.y + a.h <= c.y || c.y + c.h <= a.y).toBe(true);
      }
    for (const s of SEATS) {
      const { deck, discard } = homeSpots(s, b, SEATS);
      for (const p of [deck, discard]) {
        expect(p.x).toBeGreaterThan(70);
        expect(p.x).toBeLessThan(b.w - 70);
        expect(p.y).toBeGreaterThan(70);
        expect(p.y).toBeLessThan(b.h - 70);
      }
    }
  });

  it('finds open spots in front of a seat', () => {
    const b = tableBox(['south'], 100, 140);
    const taken: Point[] = [];
    for (let i = 0; i < 6; i++) taken.push(freeSpot('south', b, ['south'], taken));
    expect(new Set(taken.map((p) => `${p.x},${p.y}`)).size).toBe(6);
    for (const p of taken) expect(p.y).toBeLessThan(b.h - 150);
  });

  it('seats two players opposite each other', () => {
    expect(defaultSeats(1)).toEqual(['south']);
    expect(defaultSeats(2)).toEqual(['south', 'north']);
    expect(defaultSeats(4)).toEqual(SEATS);
  });
});

describe('decks', () => {
  it('turns a set into a deck using the quantity field', async () => {
    const game = (await loadWorkspace(demoWorkspaceFs())).games[0]!;
    const d = setDeck(game, game.sets[0]!);
    expect(d.entries[0]).toEqual({ key: 'core/c001', count: 3 });
    expect(deckSize(d)).toBeGreaterThan(14);
  });

  it('round-trips deck files and reports broken ones', async () => {
    const game = (await loadWorkspace(demoWorkspaceFs())).games[0]!;
    const fs = new MemoryFs('ws', { [`${game.path}/decks/bad.json`]: '{ nope' });
    await saveDeck(fs, game, { id: 'file:fire', file: 'fire', name: 'Fire', entries: [{ key: 'core/c001', count: 3 }] });
    const { decks, problems } = await loadDecks(fs, game);
    expect(decks).toEqual([{ id: 'file:fire', file: 'fire', name: 'Fire', entries: [{ key: 'core/c001', count: 3 }] }]);
    expect(problems[0]).toMatch(/^decks\/bad.json: Not valid JSON/);
    expect(parseDeck(deckText(decks[0]!), 'fire').deck).toEqual(decks[0]);
  });
});
