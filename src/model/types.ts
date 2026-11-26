/**
 * Data model. See docs/architecture.md for the file formats.
 * Nothing in here may refer to a specific game's fields.
 */

export type FieldType = 'text' | 'richtext' | 'number' | 'boolean' | 'choice' | 'multi' | 'image' | 'color';

export interface Field {
  id: string;
  type: FieldType;
  label?: string;
  identifying?: boolean;
  choices?: string[];
  source?: 'templates';
  colors?: Record<string, string>;
  min?: number;
  max?: number;
  default?: string | number | boolean;
  role?: 'quantity';
  computed?: string;
  stats?: { bin?: number; hidden?: boolean };
}

export interface CardSize {
  widthMm: number;
  heightMm: number;
  bleedMm: number;
  safeMm: number;
  dpi: number;
  cornerRadiusMm?: number;
}

export interface IconDef {
  file: string;
  /** Scale relative to the font size (1 = cap height-ish). */
  scale?: number;
  dx?: number;
  dy?: number;
  tint?: string;
}

export interface Keyword {
  name: string;
  match: string;
  reminder?: string;
  auto?: 'always' | 'firstUse' | 'never';
}

export interface StatisticDef {
  field: string;
  numeric?: boolean;
  bin?: number;
  splitList?: boolean;
  order?: string[];
}

export interface GameDef {
  formatVersion: number;
  name: string;
  card: CardSize;
  fields: Field[];
  icons?: { aliases?: Record<string, string> } & Record<string, IconDef | Record<string, string> | undefined>;
  keywords?: Keyword[];
  statistics?: StatisticDef[];
  variables?: Record<string, string>;
  fonts?: FontDef[];
  style?: { find: string; use: string }[];
  balance?: { cost?: string; value?: string };
  print?: { minPpi?: number; minTextPt?: number; minLinePt?: number };
  text?: { smartPunctuation?: boolean };
  playtest?: { handSize?: number; drawPerTurn?: number; counters?: { name: string; start: number }[] };
}

/** [x, y, width, height] in template px (design DPI, origin = top-left of the bleed area). */
export type Rect = [number, number, number, number];
export type Pt = [number, number];

/** A color: CSS color text (may contain {expressions}), or a gradient. */
export type Paint =
  | string
  | { type: 'linear'; angle?: number; stops: [number, string][] }
  | { type: 'radial'; stops: [number, string][] };

export interface Stroke {
  color: string;
  width: number;
}

export interface Shadow {
  color: string;
  blur?: number;
  dx?: number;
  dy?: number;
}

export interface FontRef {
  family: string;
  size: number;
  weight?: number;
  style?: 'normal' | 'italic';
}

interface LayerBase {
  id: string;
  name?: string;
  showIf?: string;
  opacity?: number;
  blend?: GlobalCompositeOperation;
  hidden?: boolean;
  locked?: boolean;
  rotate?: number;
  /** Only in an inheriting template: place this layer after/before another one. */
  after?: string;
  before?: string;
  /** Only in an inheriting template: drop the inherited layer with this id. */
  remove?: boolean;
}

export interface ShapeLayer extends LayerBase {
  type: 'shape';
  shape: 'rect' | 'roundrect' | 'ellipse' | 'polygon';
  rect?: Rect;
  points?: Pt[];
  radius?: number;
  fill?: Paint;
  stroke?: Stroke;
}

export interface ImageLayer extends LayerBase {
  type: 'image';
  /** File path inside the game's assets folder; may contain {expressions}. */
  src: string;
  rect: Rect;
  fit?: 'cover' | 'contain' | 'stretch';
  /** Where the image sits when it doesn't fill the box (0..1 each). Default centre. */
  focus?: [number, number];
  radius?: number;
}

export interface TextLayer extends LayerBase {
  type: 'text';
  text: string;
  rect?: Rect;
  /** A polygon text area (wins over rect). */
  polygon?: Pt[];
  font: FontRef;
  color?: string;
  align?: 'left' | 'center' | 'right' | 'justify';
  valign?: 'top' | 'middle' | 'bottom';
  lineHeight?: number;
  paragraphSpacing?: number;
  shrink?: { min: number };
  letterSpacing?: number;
  stroke?: Stroke;
  shadow?: Shadow;
  iconScale?: number;
  transform?: 'uppercase' | 'lowercase';
  reminders?: 'auto' | 'all' | 'none';
}

export interface IconsLayer extends LayerBase {
  type: 'icons';
  /** Expression giving a comma-separated list of icon names, e.g. "{element}". */
  icons?: string;
  repeat?: { icon: string; count: string };
  rect: Rect;
  /** Icon size in px (default: the rect's smaller side). */
  size?: number;
  gap?: number;
  direction?: 'row' | 'column';
  align?: 'start' | 'center' | 'end';
}

export interface GroupLayer extends LayerBase {
  type: 'group';
  layers: Layer[];
  clip?: { shape: 'rect' | 'roundrect' | 'ellipse' | 'polygon'; rect?: Rect; points?: Pt[]; radius?: number };
  offset?: Pt;
}

export type Layer = ShapeLayer | ImageLayer | TextLayer | IconsLayer | GroupLayer;
export type LayerType = Layer['type'];

/** A layer entry as written in a template file: in an inheriting template it may only override some properties. */
export type LayerPatch = Partial<Layer> & { id: string };

export interface FontDef {
  family: string;
  file: string;
  weight?: number;
  style?: 'normal' | 'italic';
}

export interface Face {
  layers?: LayerPatch[];
  useTemplate?: string;
}

export interface TemplateDef {
  formatVersion: number;
  id: string;
  name?: string;
  extends?: string;
  abstract?: boolean;
  /**
   * "landscape" turns the card sideways: the canvas is the game's card size
   * with width and height swapped. Inherited through `extends`. Default portrait.
   */
  orientation?: 'portrait' | 'landscape';
  faces: Record<string, Face>;
}

export interface SetDef {
  formatVersion: number;
  name: string;
  code?: string;
  numbering?: string;
}

export interface Card {
  id: string;
  /** Raw cell values by column name, exactly as stored in the CSV. */
  values: Record<string, string>;
  /** 1-based row number in the CSV (header is row 1), for messages. */
  row: number;
}

export interface CardSet {
  id: string;
  path: string;
  def: SetDef;
  columns: string[];
  cards: Card[];
}

export interface Game {
  id: string;
  /** Folder of the game, relative to the workspace root ("" if the root is the game). */
  path: string;
  def: GameDef;
  templates: Record<string, TemplateDef>;
  sets: CardSet[];
}

export interface WorkspaceDef {
  formatVersion: number;
  name?: string;
}

export interface Issue {
  level: 'error' | 'warning';
  file: string;
  message: string;
}

export interface Workspace {
  name: string;
  def: WorkspaceDef;
  games: Game[];
  issues: Issue[];
}
