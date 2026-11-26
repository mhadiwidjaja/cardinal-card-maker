/**
 * Table geometry for up to four players, one per edge. Positions are in table
 * units (an upright card is `cw` × `ch`); the view scales the whole table to fit.
 *
 * Each seat has its own frame: `u` runs along the edge to that player's right,
 * `v` runs from the edge towards the middle.
 */

export type Seat = 'south' | 'west' | 'north' | 'east';
/** Clockwise from the bottom edge, the default order of play. */
export const SEATS: Seat[] = ['south', 'west', 'north', 'east'];
export const SEAT_LABEL: Record<Seat, string> = { south: 'South (bottom)', west: 'West (left)', north: 'North (top)', east: 'East (right)' };
/** Degrees a card turns so its top points away from the player in that seat. */
export const SEAT_TURN: Record<Seat, number> = { south: 0, west: 90, north: 180, east: 270 };

export interface Box {
  w: number;
  h: number;
  cw: number;
  ch: number;
}
export interface Point {
  x: number;
  y: number;
}

const across = (seat: Seat) => seat === 'south' || seat === 'north';
/** One grid step: room for a card even when it is turned sideways. */
const step = (b: Pick<Box, 'cw' | 'ch'>) => Math.max(b.cw, b.ch) + 16;
/** Depth of the strip along each edge that holds a player's piles. */
const homeDepth = (b: Box) => step(b) + 24;

export function tableBox(seats: Seat[], cw: number, ch: number): Box {
  const L = step({ cw, ch });
  const sides = seats.includes('east') || seats.includes('west');
  const both = seats.includes('north') && seats.includes('south');
  return { w: Math.round((sides ? 7.5 : both ? 9 : 7) * L), h: Math.round(Math.max(both ? 7 * L : 4 * L, sides ? 6 * L : 0)), cw, ch };
}

export function seatPoint(seat: Seat, u: number, v: number, b: Box): Point {
  switch (seat) {
    case 'south':
      return { x: b.w / 2 + u, y: b.h - v };
    case 'north':
      return { x: b.w / 2 - u, y: v };
    case 'west':
      return { x: v, y: b.h / 2 + u };
    case 'east':
      return { x: b.w - v, y: b.h / 2 - u };
  }
}

/** Half the usable length of a seat's edge, leaving the corners to the neighbouring seats. */
function halfSpan(seat: Seat, b: Box, seats: Seat[]): number {
  const crossing = across(seat) ? seats.some((s) => !across(s)) : seats.some(across);
  return (across(seat) ? b.w : b.h) / 2 - (crossing ? homeDepth(b) : 0);
}

/** Where a player's deck and discard pile start: on their right, along their edge. */
export function homeSpots(seat: Seat, b: Box, seats: Seat[]): { deck: Point; discard: Point } {
  const s = halfSpan(seat, b, seats);
  const L = step(b);
  const v = homeDepth(b) / 2;
  return { deck: seatPoint(seat, s - 1.5 * L, v, b), discard: seatPoint(seat, s - 0.5 * L, v, b) };
}

/** The strip along a seat's edge, as a rectangle on the table (for drawing). */
export function homeZone(seat: Seat, b: Box, seats: Seat[]): { x: number; y: number; w: number; h: number } {
  const s = halfSpan(seat, b, seats);
  const a = seatPoint(seat, -s, 0, b);
  const c = seatPoint(seat, s, homeDepth(b), b);
  return { x: Math.min(a.x, c.x), y: Math.min(a.y, c.y), w: Math.abs(c.x - a.x), h: Math.abs(c.y - a.y) };
}

/** The first open spot in the rows in front of a seat: nearest row first, then from the middle of the row outwards. */
export function freeSpot(seat: Seat, b: Box, seats: Seat[], taken: Point[]): Point {
  const L = step(b);
  const s = halfSpan(seat, b, seats);
  const opposite: Seat = ({ south: 'north', north: 'south', west: 'east', east: 'west' } as const)[seat];
  const reach = (across(seat) ? b.h : b.w) / (seats.includes(opposite) ? 2 : 1);
  const v0 = homeDepth(b) + L / 2 + 8;
  const slots = Math.max(1, Math.floor((2 * s) / L));
  const us = Array.from({ length: slots }, (_, i) => (i - (slots - 1) / 2) * L).sort((a, c) => Math.abs(a) - Math.abs(c) || a - c);
  for (let v = v0; v <= reach - L / 2; v += L) {
    for (const u of us) {
      const p = seatPoint(seat, u, v, b);
      if (taken.every((t) => Math.hypot(t.x - p.x, t.y - p.y) > L * 0.6)) return p;
    }
  }
  const p = seatPoint(seat, 0, v0, b);
  const nudge = (taken.length % 10) * 12;
  return { x: p.x + nudge, y: p.y - nudge };
}

export function clampToTable(b: Box, p: Point): Point {
  const r = Math.min(b.cw, b.ch) / 2;
  return { x: Math.round(Math.max(r, Math.min(b.w - r, p.x))), y: Math.round(Math.max(r, Math.min(b.h - r, p.y))) };
}

/** The seats used by `n` players, going clockwise from the bottom; two players sit opposite. */
export function defaultSeats(n: number): Seat[] {
  return n === 2 ? ['south', 'north'] : SEATS.slice(0, Math.max(1, Math.min(4, n)));
}
