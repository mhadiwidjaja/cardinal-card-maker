import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { FileStore } from '../../fs/types';
import type { Game } from '../../model/types';
import { findCard, loadDecks, missingCards, setDeck, type Deck } from '../../playtest/decks';
import { clampToTable, homeZone, SEAT_TURN, type Point } from '../../playtest/layout';
import {
  addMarks,
  addPile,
  canRemovePile,
  dealEach,
  draw,
  flipPile,
  mill,
  moveCard,
  movePile,
  mulligan,
  nextTurn,
  pileById,
  pileFromCard,
  pileLabel,
  placeOf,
  playCard,
  playtestConfig,
  putDeck,
  removePile,
  renamePile,
  roll,
  setCounter,
  shuffleInto,
  shufflePile,
  startGame,
  toggleFaceDown,
  toggleTap,
  turnCardTo,
  turnPileTo,
  untapAll,
  type MoveOptions,
  type Pile,
  type Place,
  type TableState,
} from '../../playtest/table';
import type { AssetStore } from '../../render/assets';
import { DeckEditor } from './DeckEditor';
import { PlaytestRounds } from './PlaytestRounds';
import { FeedbackView } from './FeedbackView';
import { PlaytestSetup, readSetup, turnOrder, type SeatSetup } from './PlaytestSetup';
import { ContextMenu, GenericBack, NameDialog, PutDeckDialog, type MenuEntry } from './TableParts';
import { MenuButton } from '../MenuButton';
import { useCommands } from '../commands';
import { markProgress } from '../GettingStarted';
import { writeStored } from '../stored';
import { useCardImages } from './useCardImages';
import './playtest.css';
import { ResizeHandle, usePanelWidth, type PanelSize } from '../ResizeHandle';
import { keys as keyLabel } from '../keys';

const SIDE: PanelSize = { initial: 330, min: 220, max: 720 };

interface Props {
  game: Game;
  fs: FileStore;
  assets: AssetStore;
  assetVersion: number;
  active: boolean;
  unsaved?: boolean;
}

const HISTORY = 200;
/** Width of an upright card on the table, in table units. */
const TABLE_W = 104;
const HAND_W = 120;
const HAND_GAP = 6;
const HAND_ZOOM_W = 260;
const ZOOMS = [1, 1.5, 2, 3];

/** Overlaps hand cards just enough to fit the hand's width, fanned slightly around a point below the hand. */
function fanStyle(i: number, n: number, width: number): CSSProperties {
  const room = width - 16 - HAND_W;
  const step = n > 1 ? Math.min(HAND_W + HAND_GAP, room / (n - 1)) : 0;
  const tilt = n > 1 ? Math.min(1.5, 12 / n) : 0;
  return {
    marginLeft: i === 0 ? 0 : step - HAND_W,
    zIndex: i + 1,
    '--fan-rot': `${(i - (n - 1) / 2) * tilt}deg`,
  } as CSSProperties;
}

function handZoomStyle(rect: DOMRect, aspect: number): CSSProperties {
  const h = HAND_ZOOM_W * aspect;
  const left = Math.max(8, Math.min(window.innerWidth - HAND_ZOOM_W - 8, rect.left + rect.width / 2 - HAND_ZOOM_W / 2));
  return { left, top: Math.max(8, rect.top - h - 16), width: HAND_ZOOM_W };
}

const seatColor = (seat: string) => ({ '--seat': `var(--seat-${seat})` }) as CSSProperties;

type Menu = { x: number; y: number } & ({ kind: 'card'; uid: string } | { kind: 'pile'; pile: string } | { kind: 'table'; at: Point });
type Dialog = { kind: 'put'; at: Point } | { kind: 'rename'; pile: string };
interface Drag {
  kind: 'card' | 'pile';
  id: string;
  /** Pointer offset from the centre of what is dragged, in screen pixels. */
  dx: number;
  dy: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
  moved: boolean;
  /** On-screen width of the dragged card when upright. */
  w: number;
  back: boolean;
  deg: number;
}

export function PlaytestView({ game, fs, assets, assetVersion, active, unsaved = false }: Props) {
  const [rounds, setRounds] = useState(false);
  const [feedback, setFeedback] = useState(false);
  const config = playtestConfig(game.def.playtest);
  const nameField = game.def.fields.find((f) => f.identifying)?.id ?? 'name';
  const nameOf = useCallback((key: string) => findCard(game, key)?.card.values[nameField] || key.split('/').pop() || key, [game, nameField]);

  const [sideW, setSideW] = usePanelWidth('playtest-side', SIDE);
  const [fileDecks, setFileDecks] = useState<Deck[]>([]);
  const [deckProblems, setDeckProblems] = useState<string[]>([]);
  const [reloadDecks, setReloadDecks] = useState(0);
  useEffect(() => {
    let alive = true;
    loadDecks(fs, game)
      .then((r) => {
        if (!alive) return;
        setFileDecks(r.decks);
        setDeckProblems(r.problems);
      })
      .catch((e: Error) => alive && setDeckProblems([e.message]));
    return () => {
      alive = false;
    };
  }, [fs, game.path, reloadDecks]); // eslint-disable-line react-hooks/exhaustive-deps
  const [scratchDecks, setScratchDecks] = useState<Deck[]>([]);
  const decks = useMemo(() => [...fileDecks, ...scratchDecks, ...game.sets.map((s) => setDeck(game, s))], [fileDecks, scratchDecks, game]);
  const deckFor = (id: string) => decks.find((d) => d.id === id) ?? decks[0];

  const setupKey = `card-maker:playtestSetup:${game.path || game.id}`;
  const [setup, setSetupState] = useState<SeatSetup[]>(() => readSetup(setupKey));
  const setSetup = (players: SeatSetup[]) => {
    setSetupState(players);
    writeStored(setupKey, players);
  };
  const [editing, setEditing] = useState<{ deck: Deck; player: number | null } | null>(null);

  const [state, setState] = useState<TableState | null>(null);
  const past = useRef<TableState[]>([]);
  const future = useRef<TableState[]>([]);
  const shelved = useRef<TableState | null>(null);
  const apply = useCallback((fn: (s: TableState) => TableState) => {
    setState((s) => {
      if (!s) return s;
      const next = fn(s);
      if (next === s) return s;
      past.current = [...past.current.slice(-HISTORY), s];
      future.current = [];
      return next;
    });
  }, []);
  const undo = useCallback(() => {
    setState((s) => {
      const prev = past.current.pop();
      if (!prev || !s) return s;
      future.current.push(s);
      return prev;
    });
  }, []);
  const redo = useCallback(() => {
    setState((s) => {
      const next = future.current.pop();
      if (!next || !s) return s;
      past.current.push(s);
      return next;
    });
  }, []);

  /** The player whose hand is on screen; everything done at the table is done as them. */
  const [viewer, setViewer] = useState(0);
  /** Hides every card until the player now at the screen says they are ready. */
  const [curtain, setCurtain] = useState(false);
  const multi = !!state && state.players.length > 1;
  const me = state ? Math.min(viewer, state.players.length - 1) : 0;

  const aspect = game.def.card.heightMm / game.def.card.widthMm;
  const cardH = Math.round(TABLE_W * aspect);
  const corner = game.def.card.cornerRadiusMm;
  const radius = corner ? `${(corner / game.def.card.widthMm) * 100}% / ${(corner / game.def.card.heightMm) * 100}%` : '4px';
  const radiusSideways = corner ? `${(corner / game.def.card.heightMm) * 100}% / ${(corner / game.def.card.widthMm) * 100}%` : '4px';

  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  // Read by the keys: a key pressed right after the pointer moves must act on the new card, before React re-renders.
  const hoveredNow = useRef<string | null>(null);
  const pointAt = (uid: string | null) => {
    hoveredNow.current = uid;
    setHovered(uid);
  };
  const pointAway = (uid: string) => hoveredNow.current === uid && pointAt(null);
  const [hoveredPile, setHoveredPile] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [browse, setBrowse] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [handZoom, setHandZoom] = useState<{ uid: string; rect: DOMRect } | null>(null);

  function clearFocus() {
    setSelected(null);
    pointAt(null);
    setHoveredPile(null);
    setRevealed(null);
    setMenu(null);
    setBrowse(null);
    setHandZoom(null);
  }

  function start() {
    const order = turnOrder(setup);
    const players = order.map((p) => ({
      name: p.name.trim() || `Player ${setup.indexOf(p) + 1}`,
      seat: p.seat,
      deck: (deckFor(p.deck)?.entries ?? []).filter((e) => findCard(game, e.key)),
    }));
    if (players.every((p) => p.deck.length === 0)) return;
    const prev = state ?? shelved.current;
    past.current = prev ? [...past.current, prev] : [];
    future.current = [];
    shelved.current = null;
    clearFocus();
    markProgress(game.path || game.id, 'playtest');
    setState(startGame(players, config, (Date.now() ^ (Math.random() * 1e9)) | 0, { w: TABLE_W, h: cardH }, nameOf));
    setViewer(0);
    setCurtain(players.length > 1);
  }

  function toSetup() {
    shelved.current = state;
    clearFocus();
    setState(null);
    setCurtain(false);
  }

  function resume() {
    const s = shelved.current;
    if (!s) return;
    shelved.current = null;
    setState(s);
    setCurtain(s.players.length > 1);
  }

  function showHand(player: number) {
    clearFocus();
    setViewer(player);
    setCurtain(true);
  }

  function passTurn() {
    if (!state) return;
    const next = (state.current + 1) % state.players.length;
    apply((s) => nextTurn(s, config, nameOf));
    if (state.players.length > 1) showHand(next);
  }

  const setupKeys = setup.map((p) => p.deck).join('\n');
  const keys = useMemo(
    () => (state ? Object.values(state.cards).map((c) => c.key) : setup.flatMap((p) => deckFor(p.deck)?.entries.map((e) => e.key) ?? [])),
    [state, setupKeys, decks], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const images = useCardImages(game, assets, keys, assetVersion);
  const pending = new Set(keys).size - [...new Set(keys)].filter((k) => images.has(k)).length;

  /** What the player at the screen may see of a card: its face, its back, or nothing (another player's hand). */
  function sight(uid: string): 'front' | 'back' | null {
    if (!state) return null;
    const at = placeOf(state, uid);
    const c = state.cards[uid];
    if (!at || !c) return null;
    if (at.zone === 'hand') return at.player === me ? 'front' : null;
    if (at.zone === 'pile') return !pileById(state, at.pile)!.faceDown || revealed === uid ? 'front' : 'back';
    return !c.faceDown || !multi || c.side === me ? 'front' : 'back';
  }

  const wrapRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const handRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(0.5);
  const [zoom, setZoom] = useState(1);
  const [handWidth, setHandWidth] = useState(0);
  const box = state?.box;
  const shown = !!state && !curtain;
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || !box) return;
    const measure = () => setFit(Math.max(0.2, Math.min((el.clientWidth - 12) / box.w, (el.clientHeight - 12) / box.h)));
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [box?.w, box?.h, shown]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = handRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHandWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [shown]);
  const scale = fit * zoom;
  const toBoard = (cx: number, cy: number): Point => {
    const r = boardRef.current!.getBoundingClientRect();
    return { x: (cx - r.left) / scale, y: (cy - r.top) / scale };
  };
  const seatTurn = (side: number | null) => (side == null || !state ? 0 : SEAT_TURN[state.players[side]?.seat ?? 'south']);

  const play = (uid: string, faceDown = false) => apply((s) => playCard(s, uid, me, { faceDown }, nameOf));
  const toHand = (uid: string, player = me) => apply((s) => moveCard(s, uid, { zone: 'hand', player }, me, {}, nameOf));
  const toPile = (uid: string, pile: string, index?: number) => apply((s) => moveCard(s, uid, { zone: 'pile', pile }, me, { index }, nameOf));
  const ownerOf = (uid: string) => state?.cards[uid]?.owner ?? me;
  const discard = (uid: string) => state && toPile(uid, state.players[ownerOf(uid)]!.discard);
  const myDeck = state?.players[me]?.deck ?? '';

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable], [role="dialog"]') || editing || dialog || curtain) return;
      const k = e.key.toLowerCase();
      if (e.ctrlKey || e.metaKey) {
        if (k === 'z' && !e.shiftKey) undo();
        else if (k === 'y' || (k === 'z' && e.shiftKey)) redo();
        else return;
        e.preventDefault();
        return;
      }
      if (e.altKey) return;
      if (k === 'escape') {
        setMenu(null);
        setBrowse(null);
        setSelected(null);
        setRevealed(null);
        return;
      }
      if (!state) {
        if (k === 'enter' && !t.closest('button')) start();
        return;
      }
      const handled = (() => {
        switch (k) {
          case 'd':
            return apply((s) => draw(s, me, 1, nameOf)), true;
          case 's':
            return apply((s) => shufflePile(s, myDeck, me)), true;
          case 'n':
            return passTurn(), true;
          case 'u':
            return apply((s) => untapAll(s, me)), true;
        }
        const card = hoveredNow.current ?? selected;
        const at = card && sight(card) ? placeOf(state, card) : null;
        if (!card || !at || at.zone === 'pile') return false;
        switch (k) {
          case 't':
            return at.zone === 'table' && apply((s) => toggleTap(s, card)), true;
          case 'f':
            return at.zone === 'table' && apply((s) => toggleFaceDown(s, card)), true;
          case 'p':
            return at.zone === 'hand' && play(card), true;
          case 'h':
            return toHand(card), true;
          case 'delete':
          case 'backspace':
          case 'x':
            return discard(card), true;
          case '+':
          case '=':
            return at.zone === 'table' && apply((s) => addMarks(s, card, 1)), true;
          case '-':
            return at.zone === 'table' && apply((s) => addMarks(s, card, -1)), true;
        }
        return false;
      })();
      if (handled) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);

  function startDrag(e: ReactPointerEvent<HTMLElement>, d: Omit<Drag, 'x' | 'y' | 'startX' | 'startY' | 'moved'>, onClick: () => void) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { ...d, x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, moved: false };
    const move = (ev: PointerEvent) => {
      const cur = dragRef.current;
      if (!cur) return;
      const moved = cur.moved || Math.hypot(ev.clientX - cur.startX, ev.clientY - cur.startY) > 5;
      dragRef.current = { ...cur, x: ev.clientX, y: ev.clientY, moved };
      if (moved) setDrag(dragRef.current);
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const cur = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (!cur) return;
      if (cur.moved) drop(cur, ev.clientX, ev.clientY);
      else onClick();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function onCardDown(e: ReactPointerEvent<HTMLElement>, uid: string, where: 'hand' | 'table') {
    const r = e.currentTarget.getBoundingClientRect();
    const c = state!.cards[uid]!;
    startDrag(
      e,
      {
        kind: 'card',
        id: uid,
        dx: e.clientX - (r.left + r.width / 2),
        dy: e.clientY - (r.top + r.height / 2),
        w: where === 'table' ? TABLE_W * scale : HAND_W,
        back: sight(uid) === 'back' || (where === 'table' && c.faceDown),
        deg: where === 'table' ? seatTurn(c.side) + (c.tapped ? 90 : 0) : 0,
      },
      () => setSelected(uid),
    );
  }

  function onPileDown(e: ReactPointerEvent<HTMLElement>, p: Pile, handle: boolean) {
    const r = boardRef.current!.getBoundingClientRect();
    const top = p.cards[0];
    const whole = handle || e.shiftKey || !top;
    startDrag(
      e,
      { kind: whole ? 'pile' : 'card', id: whole ? p.id : top!, dx: e.clientX - (r.left + p.x * scale), dy: e.clientY - (r.top + p.y * scale), w: TABLE_W * scale, back: !!top && sight(top) === 'back', deg: seatTurn(p.side) },
      () => clickPile(p),
    );
  }

  function clickPile(p: Pile) {
    const top = p.cards[0];
    if (!top) return;
    if (p.faceDown && (p.side === me || p.side === null || !multi)) apply((s) => draw(s, me, 1, nameOf, p.id));
    else if (!p.faceDown) setBrowse(p.id);
    else setSelected(top);
  }

  function handIndex(uid: string, cx: number): number {
    const others = [...(handRef.current?.querySelectorAll<HTMLElement>('[data-uid]') ?? [])].filter((el) => el.dataset.uid !== uid);
    return others.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.left + r.width / 2 < cx;
    }).length;
  }

  function drop(d: Drag, cx: number, cy: number) {
    const where = document.elementFromPoint(cx, cy)?.closest<HTMLElement>('[data-drop]')?.dataset.drop;
    if (!where || !state) return;
    // The card keeps the same point under the pointer at its size on the table.
    const k = (TABLE_W * scale) / d.w;
    const at = toBoard(cx - d.dx * k, cy - d.dy * k);
    if (d.kind === 'pile') {
      if (where === 'table' || where.startsWith('pile:')) apply((s) => movePile(s, d.id, at));
      return;
    }
    const uid = d.id;
    let to: Place;
    let opts: MoveOptions = {};
    if (where === 'table') {
      to = { zone: 'table' };
      opts = at;
    } else if (where.startsWith('pile:')) to = { zone: 'pile', pile: where.slice(5) };
    else if (where === 'hand') {
      to = { zone: 'hand', player: me };
      opts = { index: handIndex(uid, cx) };
    } else if (where.startsWith('hand:')) to = { zone: 'hand', player: Number(where.slice(5)) };
    else return;
    const from = placeOf(state, uid);
    if (to.zone === 'pile' && from?.zone === 'pile' && from.pile === to.pile) return;
    apply((s) => moveCard(s, uid, to, me, opts, nameOf));
    setSelected(uid);
  }

  function openMenu(e: ReactMouseEvent, m: Menu) {
    e.preventDefault();
    e.stopPropagation();
    if (m.kind === 'card') setSelected(m.uid);
    setMenu(m);
  }

  const faceBox = (w: number, sideways: boolean): CSSProperties =>
    sideways ? { width: Math.round(w * aspect), height: w, borderRadius: radiusSideways } : { width: w, height: Math.round(w * aspect), borderRadius: radius };

  const cardFace = (uid: string, w: number, back: boolean) => {
    const c = state!.cards[uid]!;
    const img = images.get(c.key);
    const src = back ? img?.back : img?.front;
    const sideways = (back ? img?.backLandscape : img?.frontLandscape) ?? false;
    return (
      <div className="pt-face" style={faceBox(w, sideways)}>
        {src ? <img src={src} alt={back ? 'Card back' : nameOf(c.key)} draggable={false} /> : back ? <GenericBack name={game.def.name} /> : <span className="pt-loading">{nameOf(c.key)}</span>}
      </div>
    );
  };

  const tableCard = (uid: string) => {
    const c = state!.cards[uid]!;
    const img = images.get(c.key);
    const sideways = !!(c.faceDown ? img?.backLandscape : img?.frontLandscape);
    const bw = sideways ? cardH : TABLE_W;
    const bh = sideways ? TABLE_W : cardH;
    const deg = seatTurn(c.side) + (c.tapped ? 90 : 0);
    const who = multi ? `${state!.players[c.side]?.name}'s ` : '';
    return (
      <div
        key={uid}
        data-uid={uid}
        className={'pt-card on-table' + (c.tapped ? ' tapped' : '') + (selected === uid ? ' selected' : '') + (drag?.kind === 'card' && drag.id === uid ? ' dragging' : '')}
        style={{ left: c.x - bw / 2, top: c.y - bh / 2, transform: `rotate(${deg}deg)` }}
        tabIndex={0}
        role="button"
        aria-label={`${who}${c.faceDown ? 'face-down card' : nameOf(c.key)}${c.tapped ? ', tapped' : ''}`}
        onPointerDown={(e) => onCardDown(e, uid, 'table')}
        onPointerEnter={() => pointAt(uid)}
        onPointerLeave={() => pointAway(uid)}
        onFocus={() => setSelected(uid)}
        onDoubleClick={() => apply((s) => toggleTap(s, uid))}
        onContextMenu={(e) => openMenu(e, { kind: 'card', uid, x: e.clientX, y: e.clientY })}
      >
        {cardFace(uid, TABLE_W, c.faceDown)}
        {c.marks > 0 && (
          <span className="pt-marks" style={{ transform: `rotate(${-deg}deg)` }} title="Counters on this card (+ / − keys)">
            {c.marks}
          </span>
        )}
      </div>
    );
  };

  const handCard = (uid: string, i: number, n: number) => (
    <div
      key={uid}
      data-uid={uid}
      className={'pt-card' + (selected === uid ? ' selected' : '') + (drag?.kind === 'card' && drag.id === uid ? ' dragging' : '')}
      style={fanStyle(i, n, handWidth)}
      tabIndex={0}
      role="button"
      aria-label={nameOf(state!.cards[uid]!.key)}
      onPointerDown={(e) => onCardDown(e, uid, 'hand')}
      onPointerEnter={(e) => {
        pointAt(uid);
        setHandZoom({ uid, rect: e.currentTarget.getBoundingClientRect() });
      }}
      onPointerLeave={() => {
        pointAway(uid);
        setHandZoom((z) => (z?.uid === uid ? null : z));
      }}
      onFocus={() => setSelected(uid)}
      onDoubleClick={() => play(uid)}
      onContextMenu={(e) => openMenu(e, { kind: 'card', uid, x: e.clientX, y: e.clientY })}
    >
      {cardFace(uid, HAND_W, false)}
    </div>
  );

  const pileView = (p: Pile) => {
    const s = state!;
    const top = p.cards[0];
    const deg = seatTurn(p.side);
    const label = pileLabel(s, p);
    const stack = p.cards.length > 30 ? 3 : p.cards.length > 10 ? 2 : p.cards.length > 1 ? 1 : 0;
    const drawable = p.faceDown && (p.side === me || p.side === null || !multi);
    return (
      <Fragment key={p.id}>
        <div
          className={`pt-pile stack-${stack}` + (drag?.kind === 'pile' && drag.id === p.id ? ' dragging' : '')}
          data-drop={`pile:${p.id}`}
          data-pile={p.id}
          style={{ left: p.x - TABLE_W / 2, top: p.y - cardH / 2, width: TABLE_W, height: cardH, transform: `rotate(${deg}deg)` }}
          role="button"
          tabIndex={0}
          aria-label={`${label}, ${p.cards.length} cards`}
          title={drawable && top ? 'Click to draw. Drag to take the top card. Right-click for more.' : top && !p.faceDown ? 'Click to look through. Drag to take the top card.' : 'Right-click for more.'}
          onPointerDown={(e) => onPileDown(e, p, false)}
          onPointerEnter={() => setHoveredPile(p.id)}
          onPointerLeave={() => setHoveredPile((h) => (h === p.id ? null : h))}
          onKeyDown={(e) => e.key === 'Enter' && clickPile(p)}
          onContextMenu={(e) => openMenu(e, { kind: 'pile', pile: p.id, x: e.clientX, y: e.clientY })}
        >
          {top ? cardFace(top, TABLE_W, sight(top) === 'back') : <span className="pt-empty-pile">empty</span>}
        </div>
        <div
          className="pt-pile-label"
          style={{ left: p.x, top: p.y + (deg % 180 ? TABLE_W : cardH) / 2, ...(p.side != null ? seatColor(s.players[p.side]!.seat) : {}) }}
          title={`${label}: drag to move the pile`}
          onPointerDown={(e) => onPileDown(e, p, true)}
          onContextMenu={(e) => openMenu(e, { kind: 'pile', pile: p.id, x: e.clientX, y: e.clientY })}
        >
          {p.name} <b>{p.cards.length}</b>
        </div>
      </Fragment>
    );
  };

  const seatPanel = (i: number) => {
    const s = state!;
    const p = s.players[i]!;
    const turn = multi && i === s.current;
    return (
      <div
        key={p.seat}
        className={`pt-seat pt-seat-${p.seat}` + (!sides || p.seat === 'west' || p.seat === 'east' ? ' column' : '') + (turn ? ' current' : '')}
        data-drop={`hand:${i}`}
        style={seatColor(p.seat)}
      >
        <div className="pt-seat-head">
          <span className="pt-dot" aria-hidden />
          <b>{p.name}</b>
          {turn && <span className="pt-seat-turn">turn</span>}
        </div>
        <span className="pt-seat-hand" title={i === me ? 'Cards in your hand' : `Cards in ${p.name}'s hand. Drop a card here to give it to them.`}>
          Hand <b>{p.hand.length}</b>
        </span>
        {p.counters.map((c, k) => {
          const label = multi ? `${p.name} ${c.name}` : c.name;
          return (
            <div key={k} className="pt-counter">
              <span className="pt-counter-name">{c.name}</span>
              <button aria-label={`${label} minus one`} onClick={() => apply((t) => setCounter(t, i, k, t.players[i]!.counters[k]!.value - 1))}>
                −
              </button>
              <input
                type="number"
                aria-label={label}
                value={c.value}
                onChange={(e) => {
                  const v = e.target.valueAsNumber;
                  if (Number.isFinite(v)) apply((t) => setCounter(t, i, k, v));
                }}
              />
              <button aria-label={`${label} plus one`} onClick={() => apply((t) => setCounter(t, i, k, t.players[i]!.counters[k]!.value + 1))}>
                +
              </button>
            </div>
          );
        })}
        {multi && i !== me && (
          <button className="pt-seat-show" onClick={() => showHand(i)} title={`Hide your hand and pass the screen to ${p.name} without ending the turn`}>
            Show hand
          </button>
        )}
      </div>
    );
  };

  const missing = setup.flatMap((p) => {
    const d = deckFor(p.deck);
    return d ? missingCards(game, d) : [];
  });

  const editDeck = (player: number | null) => {
    const d = player == null ? deckFor(setup[0]?.deck ?? '') : deckFor(setup[player]!.deck);
    if (d) setEditing({ deck: d, player });
  };
  const newDeck = () => setEditing({ deck: { id: '', name: 'New deck', entries: [] }, player: setup.length === 1 ? 0 : null });
  const putDeckHere = () => box && setDialog({ kind: 'put', at: { x: box.w / 2, y: box.h / 2 } });

  useCommands(
    'playtest',
    [
      { id: 'pt-start', group: 'Playtest', label: state ? 'Restart the game' : 'Start a game', run: () => start(), disabled: !decks.length },
      { id: 'pt-next', group: 'Playtest', label: 'Next turn', run: passTurn, disabled: !state || curtain },
      { id: 'pt-put', group: 'Playtest', label: 'Put a deck on the table…', run: putDeckHere, disabled: !state || curtain, keywords: 'shared market pile' },
      { id: 'pt-setup', group: 'Playtest', label: 'Players and decks…', run: toSetup, disabled: !state, keywords: 'seats' },
      { id: 'pt-edit', group: 'Playtest', label: 'Edit the deck…', run: () => editDeck(null), disabled: !decks.length },
      { id: 'pt-new', group: 'Playtest', label: 'New deck…', run: newDeck },
      { id: 'pt-rounds', group: 'Playtest', label: 'Playtest rounds…', run: () => setRounds(true), keywords: 'snapshot changed reprint errata' },
      { id: 'pt-feedback', group: 'Playtest', label: 'Playtester feedback…', run: () => setFeedback(true), keywords: 'ratings votes gallery' },
    ],
    active,
  );

  const focusUid = (hoveredPile && state && pileById(state, hoveredPile)?.cards[0]) || hovered || selected;
  const look = focusUid ? sight(focusUid) : null;
  const bySeat = (seat: string) => state?.players.findIndex((p) => p.seat === seat) ?? -1;
  // Without players on the left or right, the panels move beside the table, which leaves it more height.
  const sides = !!state?.players.some((p) => p.seat === 'west' || p.seat === 'east');
  const lit = state && !curtain;

  return (
    <div className="pt-view">
      <div className="pt-toolbar">
        {state && (
          <>
            <button onClick={() => start()} disabled={curtain} title="Shuffle up and deal a new game with the same players and decks (can be undone)">
              Restart
            </button>
            <button onClick={toSetup} title="Change players, seats or decks. The game is kept until you start a new one.">
              Players and decks…
            </button>
            <span className="pt-sep" />
            <span className="pt-group" role="group" aria-label="Turn">
              <button onClick={passTurn} disabled={curtain} title={`Pass the turn on. The next player untaps and draws ${config.drawPerTurn} (N)`}>
                Next turn
              </button>
              <span className="pt-turn">Turn {state.turn}</span>
              {multi && (
                <span className="pt-turn-who" style={seatColor(state.players[state.current]!.seat)}>
                  <span className="pt-dot" aria-hidden />
                  {state.players[state.current]!.name}
                </span>
              )}
            </span>
            <span className="pt-group" role="group" aria-label="Deck">
              <button onClick={() => apply((s) => draw(s, me, 1, nameOf))} disabled={curtain} title="Draw a card (D)">
                Draw
              </button>
              <button onClick={() => apply((s) => shufflePile(s, myDeck, me))} disabled={curtain} title="Shuffle your deck (S)">
                Shuffle
              </button>
              <button onClick={() => apply((s) => mulligan(s, me, undefined, nameOf))} disabled={curtain} title="Shuffle your hand into your deck and draw the same number">
                Mulligan
              </button>
              <button onClick={() => apply((s) => untapAll(s, me))} disabled={curtain} title="Untap your cards on the table (U)">
                Untap all
              </button>
            </span>
            <span className="pt-group" role="group" aria-label="Random">
              <button onClick={() => apply((s) => roll(s, 6, me))} disabled={curtain} title="Roll a six-sided die">
                🎲 d6
              </button>
              <button onClick={() => apply((s) => roll(s, 2, me))} disabled={curtain} title="Flip a coin">
                Coin
              </button>
            </span>
          </>
        )}
        <span className="spacer" />
        {state && (
          <>
            <button onClick={undo} disabled={curtain || past.current.length === 0} title={keyLabel('Undo (Ctrl+Z)')} aria-label="Undo">
              ↶
            </button>
            <button onClick={redo} disabled={curtain || future.current.length === 0} title={keyLabel('Redo (Ctrl+Y)')} aria-label="Redo">
              ↷
            </button>
          </>
        )}
        <MenuButton
          label="More"
          title="More table actions, decks, playtest rounds and feedback"
          items={[
            ...(lit
              ? [
                  { label: 'Put a deck on the table…', onClick: putDeckHere },
                  { label: 'New empty pile', onClick: () => apply((s) => addPile(s, { name: 'Pile', side: me, x: s.box.w / 2, y: s.box.h / 2, faceDown: false })[0]) },
                  { separator: true as const },
                ]
              : []),
            { label: 'New deck…', onClick: newDeck },
            { label: 'Playtest rounds…', onClick: () => setRounds(true) },
            { label: 'Feedback…', onClick: () => setFeedback(true) },
          ]}
        />
        {feedback && <FeedbackView game={game} fs={fs} onClose={() => setFeedback(false)} />}
        {rounds && <PlaytestRounds game={game} fs={fs} assets={assets} unsaved={unsaved} onClose={() => setRounds(false)} />}
      </div>
      {deckProblems.length > 0 && <p className="banner error">Some deck files could not be read: {deckProblems.join('; ')}</p>}
      {!state && missing.length > 0 && <p className="banner warn">A deck lists {missing.length} card(s) that no longer exist; they are left out: {missing.slice(0, 5).join(', ')}</p>}

      {!state ? (
        <PlaytestSetup
          players={setup}
          onChange={setSetup}
          decks={decks}
          deckFor={deckFor}
          config={config}
          onEdit={editDeck}
          onNewDeck={newDeck}
          onStart={start}
          onResume={shelved.current ? resume : undefined}
          pending={pending}
        />
      ) : curtain ? (
        <Curtain state={state} viewer={me} onReady={() => setCurtain(false)} />
      ) : (
        <div className="pt-main">
          <div className="pt-left">
            <div className={'pt-arena' + (sides ? '' : ' no-sides')}>
              {(['north', 'west', 'east', 'south'] as const).map((seat) => {
                const i = bySeat(seat);
                return i >= 0 ? seatPanel(i) : null;
              })}
              <div className="pt-table-frame">
                <div
                  className="pt-table"
                  data-drop="table"
                  ref={wrapRef}
                  onPointerDown={(e) => e.target === e.currentTarget && setSelected(null)}
                  onContextMenu={(e) => openMenu(e, { kind: 'table', at: toBoard(e.clientX, e.clientY), x: e.clientX, y: e.clientY })}
                >
                  <div className="pt-surface" style={{ width: state.box.w * scale, height: state.box.h * scale }}>
                    <div
                      className="pt-board"
                      data-drop="table"
                      ref={boardRef}
                      style={{ width: state.box.w, height: state.box.h, transform: `scale(${scale})`, '--scale': scale } as CSSProperties}
                      onPointerDown={(e) => e.target === e.currentTarget && setSelected(null)}
                    >
                      {state.players.map((p) => {
                        const z = homeZone(p.seat, state.box, state.players.map((x) => x.seat));
                        return <div key={p.seat} className="pt-home" style={{ left: z.x, top: z.y, width: z.w, height: z.h, ...seatColor(p.seat) }} />;
                      })}
                      {state.piles.map(pileView)}
                      {state.table.map(tableCard)}
                    </div>
                  </div>
                  {state.table.length === 0 && <div className="pt-hint">Drag cards from your hand onto the table, or double-click them</div>}
                </div>
                <div className="pt-zoom-ctl" role="group" aria-label="Table zoom">
                  <button onClick={() => setZoom((z) => ZOOMS[Math.max(0, ZOOMS.indexOf(z) - 1)]!)} disabled={zoom === ZOOMS[0]} aria-label="Zoom out" title="Zoom out">
                    −
                  </button>
                  <button onClick={() => setZoom(1)} title="Fit the whole table">
                    Fit
                  </button>
                  <button onClick={() => setZoom((z) => ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(z) + 1)]!)} disabled={zoom === ZOOMS.at(-1)} aria-label="Zoom in" title="Zoom in">
                    +
                  </button>
                </div>
              </div>
            </div>
            <div className="pt-bottom">
              <div className="pt-hand" data-drop="hand" ref={handRef} aria-label={multi ? `${state.players[me]!.name}'s hand` : 'Hand'} style={seatColor(state.players[me]!.seat)}>
                <span className="pt-hand-label">
                  {multi ? `${state.players[me]!.name}'s hand` : 'Hand'} · {state.players[me]!.hand.length}
                </span>
                {state.players[me]!.hand.length === 0 && <div className="pt-hint">Hand is empty</div>}
                {state.players[me]!.hand.map((uid, i, hand) => handCard(uid, i, hand.length))}
              </div>
              {handZoom && !drag && state.players[me]!.hand.includes(handZoom.uid) && (
                <div className="pt-hand-zoom" style={handZoomStyle(handZoom.rect, aspect)} aria-hidden>
                  {cardFace(handZoom.uid, HAND_ZOOM_W, false)}
                </div>
              )}
            </div>
          </div>
          <ResizeHandle panel="right" width={sideW} size={SIDE} onWidth={setSideW} label="Side panel width" />
          <aside className="pt-side" style={{ width: sideW }}>
            <div className="pt-zoom">
              {focusUid && look ? (
                <>
                  {cardFace(focusUid, Math.max(150, sideW - 30), look === 'back')}
                  <div className="pt-zoom-caption">
                    <b>{look === 'back' ? 'Face-down card' : nameOf(state.cards[focusUid]!.key)}</b>
                    <span className="muted small"> · {whereText(state, focusUid, me)}</span>
                  </div>
                  <p className="muted small pt-keys">
                    <kbd>T</kbd> tap · <kbd>F</kbd> flip · <kbd>P</kbd> play · <kbd>H</kbd> to hand · <kbd>X</kbd> discard · <kbd>+</kbd>/<kbd>−</kbd> counters
                  </p>
                </>
              ) : (
                <p className="muted small pt-zoom-empty">Point at a card to see it large here.</p>
              )}
            </div>
            <div className="pt-log" aria-label="Game log">
              <h3>Log</h3>
              <ol>
                {state.log.map((l, i) => (
                  <li key={state.log.length - i}>{l}</li>
                ))}
              </ol>
            </div>
          </aside>
        </div>
      )}

      {drag && state && (drag.kind === 'pile' || state.cards[drag.id]) && (
        <div className="pt-ghost" style={{ left: drag.x - drag.dx, top: drag.y - drag.dy }}>
          <div style={{ transform: `translate(-50%, -50%) rotate(${drag.deg}deg) scale(${drag.w / TABLE_W})` }}>{ghostFace(drag)}</div>
        </div>
      )}

      {menu && state && <ContextMenu x={menu.x} y={menu.y} close={() => setMenu(null)} items={menuItems(menu)} />}

      {browse && state && pileById(state, browse) && (
        <div className="modal-back" onClick={() => setBrowse(null)}>
          <div className="modal pt-viewer" role="dialog" aria-label={pileLabel(state, pileById(state, browse)!)} onClick={(e) => e.stopPropagation()}>
            <h3>
              {pileLabel(state, pileById(state, browse)!)} ({pileById(state, browse)!.cards.length})<span className="muted small"> · top card first</span>
            </h3>
            {pileById(state, browse)!.cards.length === 0 && <p className="muted">Empty.</p>}
            <div className="pt-viewer-grid">
              {pileById(state, browse)!.cards.map((uid) => (
                <div key={uid} className="pt-viewer-card">
                  {cardFace(uid, 110, false)}
                  <div className="pt-viewer-actions">
                    <button onClick={() => toHand(uid)}>To hand</button>
                    <button onClick={() => play(uid)}>Play</button>
                  </div>
                </div>
              ))}
            </div>
            <div className="modal-buttons">
              <button
                onClick={() => {
                  apply((s) => shufflePile(s, browse, me));
                  setBrowse(null);
                }}
              >
                Shuffle and close
              </button>
              <button className="primary" onClick={() => setBrowse(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {dialog?.kind === 'put' && (
        <PutDeckDialog
          decks={decks}
          onDone={(pick) => {
            const at = dialog.at;
            setDialog(null);
            if (pick) apply((s) => putDeck(s, pick.deck.entries.filter((e) => findCard(game, e.key)), { name: pick.name, side: null, ...clampToTable(s.box, at) }, me));
          }}
        />
      )}
      {dialog?.kind === 'rename' && state && (
        <NameDialog
          title="Rename the pile"
          initial={pileById(state, dialog.pile)?.name ?? ''}
          onDone={(name) => {
            const id = dialog.pile;
            setDialog(null);
            if (name) apply((s) => renamePile(s, id, name));
          }}
        />
      )}

      {editing && (
        <DeckEditor
          game={game}
          fs={fs}
          assets={assets}
          assetVersion={assetVersion}
          deck={editing.deck}
          existing={decks}
          onClose={(saved) => {
            const player = editing.player;
            setEditing(null);
            if (!saved) return;
            if (saved.file) setReloadDecks((n) => n + 1);
            else setScratchDecks((list) => [...list.filter((d) => d.id !== saved.id), saved]);
            if (player != null) setSetup(setup.map((p, i) => (i === player ? { ...p, deck: saved.id } : p)));
          }}
        />
      )}
    </div>
  );

  function ghostFace(d: Drag) {
    if (d.kind === 'card') return cardFace(d.id, TABLE_W, d.back);
    const top = pileById(state!, d.id)?.cards[0];
    return top ? cardFace(top, TABLE_W, d.back) : <div className="pt-face pt-empty-pile" style={faceBox(TABLE_W, false)} />;
  }

  function menuItems(m: Menu): MenuEntry[] {
    if (!state) return [];
    const players = state.players;
    if (m.kind === 'table') {
      return [
        { label: 'New empty pile here', run: () => apply((s) => addPile(s, { name: 'Pile', side: me, ...clampToTable(s.box, m.at), faceDown: false })[0]) },
        { label: 'Put a deck here…', run: () => setDialog({ kind: 'put', at: m.at }) },
      ];
    }
    if (m.kind === 'pile') {
      const p = pileById(state, m.pile);
      if (!p) return [];
      const own = players.findIndex((pl) => pl.deck === p.id);
      const into = players[p.side ?? me]!.deck;
      const items: MenuEntry[] = [];
      if (p.cards.length) {
        items.push({ label: 'Draw a card', key: own === me ? 'D' : undefined, run: () => apply((s) => draw(s, me, 1, nameOf, p.id)) });
        if (multi) items.push({ label: 'Deal one to each player', run: () => apply((s) => dealEach(s, p.id, nameOf)) });
        items.push({ label: `Look through (${p.cards.length})`, run: () => setBrowse(p.id) });
        items.push({ label: 'Shuffle', key: own === me ? 'S' : undefined, run: () => apply((s) => shufflePile(s, p.id, me)) });
        if (p.faceDown)
          items.push({
            label: 'Reveal the top card',
            run: () => {
              setRevealed(p.cards[0]!);
              setSelected(p.cards[0]!);
            },
          });
        if (own >= 0) items.push({ label: 'Top card to discard (mill)', run: () => apply((s) => mill(s, own, nameOf)) });
        items.push({ label: p.faceDown ? 'Turn the pile face up' : 'Turn the pile face down', run: () => apply((s) => flipPile(s, p.id, me)) });
        if (into !== p.id) items.push({ label: `Shuffle into ${multi ? pileLabel(state, pileById(state, into)!) : 'the deck'}`, run: () => apply((s) => shuffleInto(s, p.id, into, me)) });
      }
      if (multi) {
        players.forEach((pl, i) => p.side !== i && items.push({ label: `Turn to face ${pl.name}`, run: () => apply((s) => turnPileTo(s, p.id, i)) }));
        if (p.side !== null) items.push({ label: 'Turn upright (shared)', run: () => apply((s) => turnPileTo(s, p.id, null)) });
      }
      items.push({ label: 'Rename…', run: () => setDialog({ kind: 'rename', pile: p.id }) });
      if (canRemovePile(state, p.id)) items.push({ label: 'Remove the empty pile', run: () => apply((s) => removePile(s, p.id)) });
      return items;
    }
    const uid = m.uid;
    const at = placeOf(state, uid);
    const c = state.cards[uid];
    if (!at || !c) return [];
    const owner = ownerOf(uid);
    const theirs = multi && owner !== me ? `${players[owner]!.name}'s deck` : 'deck';
    const items: MenuEntry[] = [];
    if (at.zone === 'table') {
      items.push({ label: c.tapped ? 'Untap' : 'Tap', key: 'T', run: () => apply((s) => toggleTap(s, uid)) });
      items.push({ label: c.faceDown ? 'Turn face up' : 'Turn face down', key: 'F', run: () => apply((s) => toggleFaceDown(s, uid)) });
      items.push({ label: 'Add a counter', key: '+', run: () => apply((s) => addMarks(s, uid, 1)) });
      if (c.marks > 0) items.push({ label: 'Remove a counter', key: '−', run: () => apply((s) => addMarks(s, uid, -1)) });
      items.push({ label: 'To hand', key: 'H', run: () => toHand(uid) });
      if (multi && c.owner != null && c.owner !== me) items.push({ label: `To ${players[c.owner]!.name}'s hand`, run: () => toHand(uid, c.owner!) });
      if (multi) players.forEach((pl, i) => c.side !== i && items.push({ label: `Turn to face ${pl.name}`, run: () => apply((s) => turnCardTo(s, uid, i)) }));
      items.push({ label: 'Start a pile with this card', run: () => apply((s) => pileFromCard(s, uid, 'Pile', me)) });
    } else {
      items.push({ label: 'Play to the table', key: 'P', run: () => play(uid) });
      items.push({ label: 'Play face down', run: () => play(uid, true) });
      if (multi) players.forEach((pl, i) => i !== me && items.push({ label: `Give to ${pl.name}`, run: () => toHand(uid, i) }));
    }
    items.push({ label: 'Discard', key: 'X', run: () => discard(uid) });
    items.push({ label: `Top of ${theirs}`, run: () => toPile(uid, players[owner]!.deck, 0) });
    items.push({ label: `Bottom of ${theirs}`, run: () => toPile(uid, players[owner]!.deck, Infinity) });
    return items;
  }
}

function whereText(s: TableState, uid: string, me: number): string {
  const at = placeOf(s, uid);
  const c = s.cards[uid]!;
  if (!at) return '';
  if (at.zone === 'hand') return 'in your hand';
  if (at.zone === 'pile') return pileLabel(s, pileById(s, at.pile)!);
  const bits = ['on the table'];
  if (s.players.length > 1 && c.side !== me) bits.push(`${s.players[c.side]?.name}'s side`);
  if (c.faceDown) bits.push(s.players.length > 1 && c.side === me ? 'face down (only you see this)' : 'face down');
  if (c.tapped) bits.push('tapped');
  return bits.join(' · ');
}

function Curtain({ state, viewer, onReady }: { state: TableState; viewer: number; onReady: () => void }) {
  const p = state.players[viewer]!;
  const current = state.players[state.current]!;
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => ref.current?.focus(), [viewer]);
  return (
    <div className="pt-curtain" role="dialog" aria-label={`Pass the screen to ${p.name}`} style={seatColor(p.seat)}>
      <div className="pt-curtain-card">
        <p className="muted">
          Turn {state.turn} · {current === p ? `${p.name}'s turn` : `${current.name}'s turn, ${p.name} looks at their hand`}
        </p>
        <h2>
          <span className="pt-dot" aria-hidden /> Pass the screen to {p.name}
        </h2>
        <p className="muted">All cards are hidden. Everyone else, look away.</p>
        <button ref={ref} className="primary" onClick={onReady}>
          Show {p.name}'s hand
        </button>
      </div>
    </div>
  );
}
